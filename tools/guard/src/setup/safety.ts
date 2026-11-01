import type { Ctx } from "../context";
import { PRODUCTION_API_ORIGIN, SAFETY_RECHECK_MS } from "../limits";
import { Refusal } from "../refusal";
import { onEdge } from "../telnyx/hazards";
import { KEYS, type PartitionRecord } from "../telnyx/partition";
import { nonprodNames, SPEC, type TelnyxSpec } from "./spec";

/**
 * The start-up checks (docs/RIG.md). The guard
 * serves nothing that touches Telnyx unless, on this deployment and within
 * the last six hours:
 *   - no nonprod resource sends its webhooks to loonext.com;
 *   - no nonprod id is also a production id;
 *   - no nonprod number is bound to a production connection or profile.
 * Plus two the design depends on elsewhere: every nonprod webhook goes to the
 * edge, and neither credential connection has an outbound voice profile
 * (an app credential must not be able to call a phone number).
 *
 * Production's resources are recognised positively, the same way production
 * recognises its numbers: anything whose webhooks reach loonext.com, and
 * whatever production's numbers (those with no billing group) are bound to.
 */
export interface SafetyState {
  state: "ok" | "unsafe" | "unconfigured";
  /** Stable reason codes; counts and names, never ids or numbers. */
  reasons: string[];
  checked_at: number;
  version: string;
}

export const SAFETY_KEY = "safety";

type Item = Record<string, unknown>;

function host(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Production's domain and every name under it. */
export function isProductionHost(value: unknown): boolean {
  const name = host(value);
  const production = new URL(PRODUCTION_API_ORIGIN).hostname.split(".").slice(-2).join(".");
  return name !== null && (name === production || name.endsWith(`.${production}`));
}

const WEBHOOK_FIELDS = [
  "webhook_event_url",
  "webhook_event_failover_url",
  "webhook_url",
  "webhook_failover_url",
  "health_webhook_url",
] as const;

function webhooks(item: Item): unknown[] {
  return WEBHOOK_FIELDS.map((field) => item[field]).filter((value) => typeof value === "string" && value !== "");
}

function idOf(item: Item | undefined): string | null {
  return item && typeof item.id === "string" && item.id ? item.id : null;
}

/** Exactly one item with this name, or a reason why not. */
function byName(items: Item[], field: string, name: string, reasons: string[]): Item | undefined {
  const found = items.filter((item) => item[field] === name);
  if (found.length > 1) reasons.push(`duplicate_name:${name}`);
  return found.length === 1 ? found[0] : undefined;
}

export interface Listings {
  billingGroups: Item[];
  outboundVoiceProfiles: Item[];
  apps: Item[];
  credentialConnections: Item[];
  messagingProfiles: Item[];
  productionNumbers: Item[];
  nonprodNumbers: Item[];
}

export async function fetchListings(ctx: Ctx, billingGroupId: string | null): Promise<Listings> {
  const telnyx = ctx.telnyx;
  if (!telnyx) throw new Refusal("telnyx.key_missing");
  return {
    billingGroups: await telnyx.listAll<Item>("/v2/billing_groups"),
    outboundVoiceProfiles: await telnyx.listAll<Item>("/v2/outbound_voice_profiles"),
    apps: await telnyx.listAll<Item>("/v2/call_control_applications"),
    credentialConnections: await telnyx.listAll<Item>("/v2/credential_connections"),
    messagingProfiles: await telnyx.listAll<Item>("/v2/messaging_profiles"),
    productionNumbers: (
      await telnyx.listAll<Item>("/v2/phone_numbers", { "filter[billing_group_id]": "null" })
    ).filter((item) => item.billing_group_id === null || item.billing_group_id === undefined || item.billing_group_id === ""),
    nonprodNumbers: billingGroupId
      ? (await telnyx.listAll<Item>("/v2/phone_numbers", { "filter[billing_group_id]": billingGroupId })).filter(
          (item) => item.billing_group_id === billingGroupId,
        )
      : [],
  };
}

/**
 * The limit-probe profile must carry no call: its limit is written up to
 * 9999 while the check runs. It is unsafe when any listed connection names
 * it, production's included, or when its name matches more than one
 * profile, so the probe could not tell which one it writes.
 */
function limitProbeInUse(listings: Listings, spec: TelnyxSpec): boolean {
  const found = listings.outboundVoiceProfiles.filter((item) => item.name === spec.limit_probe.name);
  if (found.length > 1) return true;
  const ids = new Set(found.map(idOf).filter((id): id is string => id !== null));
  return [...listings.apps, ...listings.credentialConnections].some((item) => {
    const profile = (item.outbound as { outbound_voice_profile_id?: unknown } | undefined)?.outbound_voice_profile_id;
    return typeof profile === "string" && ids.has(profile);
  });
}

export interface Assessment {
  record: PartitionRecord | null;
  extraProfiles: string[];
  reasons: string[];
  configured: boolean;
}

/** The checks over a set of listings, with no I/O: what the unit tests drive. */
export function assess(
  ctx: Pick<Ctx, "config" | "now">,
  listings: Listings,
  appProfiles: readonly string[],
  spec: TelnyxSpec = SPEC,
): Assessment {
  const reasons: string[] = [];
  const names = nonprodNames(spec);

  const group = byName(listings.billingGroups, "name", spec.billing_group.name, reasons);
  const groupId = idOf(group);
  if (!groupId) return { record: null, extraProfiles: [], reasons: [...reasons, "billing_group_missing"], configured: false };

  const ovp = (key: "voice" | "robot") => {
    const name = spec.outbound_voice_profiles.find((item) => item.key === key)?.name ?? "";
    return idOf(byName(listings.outboundVoiceProfiles, "name", name, reasons));
  };
  const appItem = (key: "voice" | "robot") => {
    const name = spec.call_control_applications.find((item) => item.key === key)?.application_name ?? "";
    return byName(listings.apps, "application_name", name, reasons);
  };
  const credentialItem = (key: "webrtc" | "sentinel") => {
    const name = spec.credential_connections.find((item) => item.key === key)?.connection_name ?? "";
    return byName(listings.credentialConnections, "connection_name", name, reasons);
  };

  const apps = { voice: appItem("voice"), robot: appItem("robot") };
  const credentials = { webrtc: credentialItem("webrtc"), sentinel: credentialItem("sentinel") };

  const messagingProfiles: Record<string, string> = {};
  for (const profile of spec.messaging_profiles.profiles) {
    const id = idOf(byName(listings.messagingProfiles, "name", profile.name, reasons));
    if (id) messagingProfiles[profile.key] = id;
  }
  const specProfileIds = new Set(Object.values(messagingProfiles));
  const extraProfiles = listings.messagingProfiles
    .filter((item) => {
      const id = idOf(item);
      if (!id || specProfileIds.has(id)) return false;
      return appProfiles.includes(id) || webhooks(item).some((url) => onEdge(ctx, url));
    })
    .map((item) => idOf(item) as string);
  const nonprodProfileIds = new Set([...specProfileIds, ...extraProfiles]);

  const nonprodResources: { kind: string; name: string; item: Item }[] = [
    ...Object.values(apps).filter(Boolean).map((item) => ({ kind: "app", name: String(item?.application_name), item: item as Item })),
    ...Object.values(credentials)
      .filter(Boolean)
      .map((item) => ({ kind: "credential_connection", name: String(item?.connection_name), item: item as Item })),
    ...listings.messagingProfiles
      .filter((item) => nonprodProfileIds.has(idOf(item) ?? ""))
      .map((item) => ({ kind: "messaging_profile", name: names.messagingProfiles.has(String(item.name)) ? String(item.name) : "app-created", item })),
  ];

  if (!ctx.config.edgeOrigin) reasons.push("edge_origin_unset");
  for (const { kind, name, item } of nonprodResources) {
    const urls = webhooks(item);
    if (urls.some(isProductionHost)) reasons.push(`points_at_production:${kind}:${name}`);
    else if (ctx.config.edgeOrigin && urls.some((url) => !onEdge(ctx, url))) {
      reasons.push(`webhook_not_edge:${kind}:${name}`);
    }
  }
  for (const item of Object.values(credentials)) {
    const outbound = item?.outbound as { outbound_voice_profile_id?: unknown } | undefined;
    if (item && outbound?.outbound_voice_profile_id) {
      reasons.push(`credential_connection_has_ovp:${String(item.connection_name)}`);
    }
  }
  if (limitProbeInUse(listings, spec)) reasons.push("limit_probe_ovp_in_use");

  const productionConnections = new Set<string>();
  const productionProfiles = new Set<string>();
  for (const item of [...listings.apps, ...listings.credentialConnections]) {
    if (webhooks(item).some(isProductionHost) && idOf(item)) productionConnections.add(idOf(item) as string);
  }
  for (const item of listings.messagingProfiles) {
    if (webhooks(item).some(isProductionHost) && idOf(item)) productionProfiles.add(idOf(item) as string);
  }
  for (const number of listings.productionNumbers) {
    if (typeof number.connection_id === "string" && number.connection_id) productionConnections.add(number.connection_id);
    if (typeof number.messaging_profile_id === "string" && number.messaging_profile_id) {
      productionProfiles.add(number.messaging_profile_id);
    }
  }

  const nonprodConnectionIds = [apps.voice, apps.robot, credentials.webrtc, credentials.sentinel]
    .map(idOf)
    .filter((id): id is string => id !== null);
  const ovpIds = { voice: ovp("voice"), robot: ovp("robot") };
  const productionOvps = new Set(
    [...listings.apps, ...listings.credentialConnections]
      .filter((item) => productionConnections.has(idOf(item) ?? ""))
      .map((item) => (item.outbound as { outbound_voice_profile_id?: unknown } | undefined)?.outbound_voice_profile_id)
      .filter((id): id is string => typeof id === "string" && id !== ""),
  );

  if (nonprodConnectionIds.some((id) => productionConnections.has(id))) reasons.push("id_overlap:connection");
  if ([...nonprodProfileIds].some((id) => productionProfiles.has(id))) reasons.push("id_overlap:messaging_profile");
  if (Object.values(ovpIds).some((id) => id !== null && productionOvps.has(id))) {
    reasons.push("id_overlap:outbound_voice_profile");
  }

  const onProduction = listings.nonprodNumbers.filter(
    (number) =>
      productionConnections.has(String(number.connection_id ?? "")) ||
      productionProfiles.has(String(number.messaging_profile_id ?? "")),
  ).length;
  if (onProduction > 0) reasons.push(`number_on_production_resource:${onProduction}`);

  const record: PartitionRecord = {
    billing_group_id: groupId,
    outbound_voice_profiles: ovpIds,
    connections: {
      voice: idOf(apps.voice),
      robot: idOf(apps.robot),
      webrtc: idOf(credentials.webrtc),
      sentinel: idOf(credentials.sentinel),
    },
    messaging_profiles: messagingProfiles,
    production: {
      connection_ids: [...productionConnections].sort(),
      messaging_profile_ids: [...productionProfiles].sort(),
    },
    discovered_at: ctx.now(),
  };
  const configured = Boolean(record.connections.voice && record.connections.robot && record.connections.webrtc);
  if (!configured) reasons.push("partition_incomplete");
  return { record, extraProfiles, reasons, configured };
}

export async function runSafetyChecks(ctx: Ctx): Promise<SafetyState> {
  const known = await ctx.store.get<PartitionRecord>(KEYS.record);
  const appProfiles = (await ctx.store.get<string[]>(KEYS.appProfiles)) ?? [];
  let listings = await fetchListings(ctx, known?.billing_group_id ?? null);
  let result = assess(ctx, listings, appProfiles);
  // The group's id is only known after the first listing on a fresh store.
  if (result.record && result.record.billing_group_id !== known?.billing_group_id) {
    listings = await fetchListings(ctx, result.record.billing_group_id);
    result = assess(ctx, listings, appProfiles);
  }

  if (result.record) {
    await ctx.store.put(KEYS.record, result.record);
    await ctx.store.put(KEYS.appProfiles, [...new Set([...appProfiles, ...result.extraProfiles])].sort());
  }
  const unsafe = result.reasons.some((reason) => !["billing_group_missing", "partition_incomplete"].includes(reason));
  const safety: SafetyState = {
    state: unsafe ? "unsafe" : result.configured ? "ok" : "unconfigured",
    reasons: result.reasons,
    checked_at: ctx.now(),
    version: ctx.versionId,
  };
  await ctx.store.put(SAFETY_KEY, safety);
  return safety;
}

/** Throws unless the checks passed on this deployment within {@link SAFETY_RECHECK_MS}. */
export async function requireSafe(ctx: Ctx): Promise<void> {
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  let safety = await ctx.store.get<SafetyState>(SAFETY_KEY);
  if (!safety || safety.version !== ctx.versionId || ctx.now() - safety.checked_at > SAFETY_RECHECK_MS) {
    try {
      safety = await runSafetyChecks(ctx);
    } catch (cause) {
      if (cause instanceof Refusal) throw cause;
      console.error("guard: start-up checks could not run:", cause instanceof Error ? cause.message : String(cause));
      throw new Refusal("startup.unsafe");
    }
  }
  if (safety.state === "unconfigured") throw new Refusal("startup.unconfigured");
  if (safety.state !== "ok") throw new Refusal("startup.unsafe");
}
