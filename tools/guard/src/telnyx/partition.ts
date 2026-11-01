import {
  PARTITION_CACHE_MS,
  STANDING_ROLES,
  type Partition,
  type StandingEntry,
  type StandingRole,
} from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { Refusal } from "../refusal";
import { SPEC } from "../setup/spec";
import { noteHeld } from "../state/ledger";

/**
 * The nonprod partition's resources, as the setup routine found or created
 * them by name. Stored in the Durable Object, never in git.
 */
export interface PartitionRecord {
  billing_group_id: string;
  outbound_voice_profiles: { voice: string | null; robot: string | null };
  connections: {
    voice: string | null;
    robot: string | null;
    webrtc: string | null;
    sentinel: string | null;
  };
  /** Spec key (robot, qa-w, ...) to profile id. */
  messaging_profiles: Record<string, string>;
  /** Production's resources, from the start-up checks: what the partition must never touch. */
  production: { connection_ids: string[]; messaging_profile_ids: string[] };
  discovered_at: number;
}

export interface OwnedNumber {
  id: string;
  phone_number: string;
  connection_id: string | null;
  messaging_profile_id: string | null;
  customer_reference: string | null;
  tags: string[];
}

interface OwnedCache {
  fetched_at: number;
  billing_group_id: string;
  numbers: OwnedNumber[];
}

/** A standing number by role, as the setup routine ordered it. */
export interface StandingNumber {
  role: StandingRole;
  phone_number: string;
}

/** Marks a standing number on Telnyx itself, so the marker survives this store. */
export const STANDING_TAG = "rig-standing";

/**
 * The customer reference a standing number is ordered with, which names its
 * role on Telnyx itself: the role survives this store, and no number is ever
 * written into git to say which is which.
 */
export function standingReference(role: StandingRole): string {
  return `rig-standing-${role.toLowerCase()}`;
}

function roleOfReference(reference: string | null): StandingRole | null {
  return STANDING_ROLES.find((role) => standingReference(role) === reference) ?? null;
}

export const KEYS = {
  record: "partition",
  owned: "partition:owned",
  standing: "partition:standing",
  /** Messaging profiles the app created through the guard. */
  appProfiles: "partition:app-profiles",
} as const;

export interface PartitionView {
  record: PartitionRecord;
  numbers: OwnedNumber[];
  byE164: Map<string, OwnedNumber>;
  byId: Map<string, OwnedNumber>;
  /** Standing numbers by E.164. */
  standing: Map<string, StandingNumber>;
  /** Connections a call may be placed on: the two Call Control apps. */
  dialConnections: Set<string>;
  /** Every nonprod connection, for registered legs and recordings. */
  connections: Set<string>;
  messagingProfiles: Set<string>;
  fetchedAt: number;
}

/** The standing role of an owned number, from this store or its Telnyx customer reference. */
export function standingRole(view: PartitionView, number: OwnedNumber): StandingRole | null {
  return view.standing.get(number.phone_number)?.role ?? roleOfReference(number.customer_reference);
}

export function isStanding(view: PartitionView, number: OwnedNumber): boolean {
  return standingRole(view, number) !== null || number.tags.includes(STANDING_TAG);
}

function ids(values: readonly (string | null)[]): Set<string> {
  return new Set(values.filter((value): value is string => typeof value === "string" && value !== ""));
}

function toOwned(item: Record<string, unknown>): OwnedNumber | null {
  if (typeof item.id !== "string" || typeof item.phone_number !== "string") return null;
  return {
    id: item.id,
    phone_number: item.phone_number,
    connection_id: typeof item.connection_id === "string" && item.connection_id ? item.connection_id : null,
    messaging_profile_id:
      typeof item.messaging_profile_id === "string" && item.messaging_profile_id
        ? item.messaging_profile_id
        : null,
    customer_reference: typeof item.customer_reference === "string" ? item.customer_reference : null,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

/**
 * The owned numbers: the live listing by billing group, every item checked
 * again, because a filter Telnyx ignored would otherwise hand the rig the
 * whole account.
 */
export async function listOwnedNumbers(ctx: Ctx, billingGroupId: string): Promise<OwnedNumber[]> {
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  const items = await ctx.telnyx.listAll<Record<string, unknown>>("/v2/phone_numbers", {
    "filter[billing_group_id]": billingGroupId,
  });
  return items
    .filter((item) => item.billing_group_id === billingGroupId)
    .map(toOwned)
    .filter((item): item is OwnedNumber => item !== null);
}

export async function invalidateOwned(ctx: Ctx): Promise<void> {
  await ctx.store.delete(KEYS.owned);
}

/** The partition, with the owned numbers at most {@link PARTITION_CACHE_MS} old. */
export async function loadPartition(ctx: Ctx, options: { fresh?: boolean } = {}): Promise<PartitionView> {
  const record = await ctx.store.get<PartitionRecord>(KEYS.record);
  if (!record) throw new Refusal("startup.unconfigured");

  let cache = await ctx.store.get<OwnedCache>(KEYS.owned);
  if (
    options.fresh ||
    !cache ||
    cache.billing_group_id !== record.billing_group_id ||
    ctx.now() - cache.fetched_at > PARTITION_CACHE_MS
  ) {
    cache = {
      fetched_at: ctx.now(),
      billing_group_id: record.billing_group_id,
      numbers: await listOwnedNumbers(ctx, record.billing_group_id),
    };
    await ctx.store.put(KEYS.owned, cache);
  }

  const standing = new Map<string, StandingNumber>();
  const stored = (await ctx.store.get<Record<string, StandingNumber>>(KEYS.standing)) ?? {};
  for (const entry of Object.values(stored)) standing.set(entry.phone_number, entry);

  const appProfiles = (await ctx.store.get<string[]>(KEYS.appProfiles)) ?? [];
  const { connections } = record;
  const view: PartitionView = {
    record,
    numbers: cache.numbers,
    byE164: new Map(cache.numbers.map((number) => [number.phone_number, number])),
    byId: new Map(cache.numbers.map((number) => [number.id, number])),
    standing,
    dialConnections: ids([connections.voice, connections.robot]),
    connections: ids([connections.voice, connections.robot, connections.webrtc, connections.sentinel]),
    messagingProfiles: ids([...Object.values(record.messaging_profiles), ...appProfiles]),
    fetchedAt: cache.fetched_at,
  };
  // Every number held this month is a month's rental off the cap, whether or
  // not anything was ordered in it, so the ledger hears of each listing.
  await noteHeld(ctx, view.numbers.length, callerNameHeld(view));
  return view;
}

/** Held numbers whose standing role has inbound caller-name lookup on. */
function callerNameHeld(view: PartitionView): number {
  const roles = new Set(SPEC.numbers.standing.filter((item) => item.caller_name_lookup).map((item) => item.role));
  return view.numbers.filter((number) => {
    const role = standingRole(view, number);
    return role !== null && roles.has(role);
  }).length;
}

/** The wire shape of GET /partition: the protocol's fields, plus each standing number's role. */
export function toWire(view: PartitionView): Partition & { standing: StandingEntry[] } {
  const { connections } = view.record;
  return {
    billing_group_id: view.record.billing_group_id,
    owned_e164: view.numbers.map((number) => number.phone_number).sort(),
    standing_e164: view.numbers
      .filter((number) => isStanding(view, number))
      .map((number) => number.phone_number)
      .sort(),
    connection_ids: {
      voice: connections.voice ?? "",
      robot: connections.robot ?? "",
      webrtc: connections.webrtc ?? "",
      sentinel: connections.sentinel ?? "",
    },
    messaging_profile_ids: [...view.messagingProfiles].sort(),
    messaging_profiles: { ...view.record.messaging_profiles },
    fetched_at: new Date(view.fetchedAt).toISOString(),
    standing: view.numbers
      .map((number) => ({ number, role: standingRole(view, number) }))
      .filter((item): item is { number: OwnedNumber; role: StandingRole } => item.role !== null)
      .map(({ number, role }) => ({
        role,
        e164: number.phone_number,
        telnyx_phone_number_id: number.id,
        messaging_profile_id: number.messaging_profile_id,
      }))
      .sort((a, b) => STANDING_ROLES.indexOf(a.role) - STANDING_ROLES.indexOf(b.role)),
  };
}
