import {
  CREDENTIALS_PER_DAY,
  COST_USD,
  MAX_NUMBERS_HELD,
  NUMBER_SCENARIO,
  ORDER_INTERVAL_MS,
  SEARCH_INTERVAL_MS,
} from "../limits";
import { Refusal } from "../refusal";
import { callerNameNumbers, SPEC, sentinelCredentialCap } from "../setup/spec";
import { requireAboveFloor } from "../state/balance";
import { dayOf, giveBack, tryTake } from "../state/counters";
import { liveLease } from "../state/lease";
import { charge, noteHeld, readTier } from "../state/ledger";
import { requirePaidLanesOpen } from "../state/signals";
import type { Ctx } from "../context";
import { forward, isDefiniteFailure, isOk, relay, type Handler, type TelnyxRequest } from "./forward";
import { onEdge } from "./hazards";
import { noteOrder, ORDER_KEYS, requireOrdering, verifyFirstOrder } from "./ordering";
import { invalidateOwned, isStanding, KEYS, type OwnedNumber } from "./partition";
import {
  CREDENTIAL_PREFIX,
  connectionOfResource,
  credentialById,
  isE164,
  rememberCredential,
  type CredentialRecord,
} from "./targets";

/**
 * The provisioning class (docs/RIG.md): an explicit list, each
 * entry with its own limits, all on nonprod resources only.
 */
type Item = Record<string, unknown>;

async function requireLeaseFor(ctx: Ctx, rule: "provisioning.search_needs_lease" | "provisioning.order_needs_lease") {
  const lease = await liveLease(ctx);
  if (!lease || lease.scenario !== NUMBER_SCENARIO) throw new Refusal(rule);
}

const search: Handler = async (request) => {
  const { ctx } = request;
  await requireLeaseFor(ctx, "provisioning.search_needs_lease");
  const last = (await ctx.store.get<number>("search:last")) ?? 0;
  if (ctx.now() - last < SEARCH_INTERVAL_MS) throw new Refusal("provisioning.search_rate");
  await ctx.store.put("search:last", ctx.now());
  return relay(await forward(request, undefined));
};

/** Every order's checks, shared with the admin's standing orders. */
export async function checkOrderBody(
  request: Pick<TelnyxRequest, "ctx" | "view">,
  body: Item,
): Promise<{ body: Item; phoneNumber: string }> {
  const { view } = request;
  const numbers = body.phone_numbers;
  if (!Array.isArray(numbers) || numbers.length !== 1 || !isE164((numbers[0] as Item | undefined)?.phone_number)) {
    throw new Refusal("provisioning.order_one_number");
  }
  if (view.numbers.length + 1 > MAX_NUMBERS_HELD) throw new Refusal("provisioning.numbers_held");
  if (body.billing_group_id !== view.record.billing_group_id) throw new Refusal("provisioning.order_group");
  if (typeof body.messaging_profile_id !== "string" || !view.messagingProfiles.has(body.messaging_profile_id)) {
    throw new Refusal("provisioning.order_profile");
  }
  // The app binds voice after the order, so its order body has no
  // connection. An order must carry one, so the guard adds the
  // voice app rather than letting a number land unbound.
  const connection = body.connection_id ?? view.record.connections.voice;
  if (typeof connection !== "string" || !view.dialConnections.has(connection)) {
    throw new Refusal("provisioning.order_connection");
  }
  return {
    body: { ...body, connection_id: connection },
    phoneNumber: (numbers[0] as Item).phone_number as string,
  };
}

/** Money and signal gates for anything that buys. */
export async function requireSpendable(ctx: Ctx): Promise<void> {
  await requirePaidLanesOpen(ctx);
  if ((await readTier(ctx)).tier === "red") throw new Refusal("budget.tier_red");
  await requireAboveFloor(ctx);
}

const order: Handler = async (request) => {
  const { ctx, view } = request;
  if (!request.body) throw new Refusal("request.body_invalid");
  await verifyFirstOrder(ctx);
  await requireOrdering(ctx);
  await requireLeaseFor(ctx, "provisioning.order_needs_lease");
  const checked = await checkOrderBody(request, request.body);
  const last = (await ctx.store.get<number>(ORDER_KEYS.last)) ?? 0;
  if (ctx.now() - last < ORDER_INTERVAL_MS) throw new Refusal("provisioning.order_interval");
  await requireSpendable(ctx);

  // Taken before the call, so a second order cannot slip in behind this one.
  await ctx.store.put(ORDER_KEYS.last, ctx.now());
  const reply = await forward(request, checked.body);
  if (isDefiniteFailure(reply)) {
    await ctx.store.put(ORDER_KEYS.last, last);
    return relay(reply);
  }
  await charge(ctx, COST_USD.numberUpfront, "one_time");
  await noteHeld(ctx, view.numbers.length + 1, callerNameNumbers());
  if (isOk(reply)) {
    const id = (reply.body as { data?: { id?: unknown } } | undefined)?.data?.id;
    await noteOrder(ctx, typeof id === "string" ? id : null, checked.phoneNumber);
  }
  return relay(reply);
};

function ownedNonStanding(request: TelnyxRequest): OwnedNumber {
  const number = request.view.byId.get(request.ids[0]);
  if (!number) throw new Refusal("provisioning.number_not_owned");
  if (isStanding(request.view, number)) throw new Refusal("provisioning.number_standing");
  return number;
}

const NUMBER_PATCH_FIELDS = new Set(["connection_id", "billing_group_id", "customer_reference"]);
const VOICE_PATCH_FIELDS = new Set(["caller_id_name_enabled", "cnam_listing"]);

const patchNumber: Handler = async (request) => {
  ownedNonStanding(request);
  const body = request.body;
  if (!body) throw new Refusal("request.body_invalid");
  for (const [field, value] of Object.entries(body)) {
    if (!NUMBER_PATCH_FIELDS.has(field)) throw new Refusal("provisioning.patch_field");
    if (field === "connection_id" && !(typeof value === "string" && request.view.dialConnections.has(value))) {
      throw new Refusal("provisioning.patch_field");
    }
    if (field === "billing_group_id" && value !== request.view.record.billing_group_id) {
      throw new Refusal("provisioning.patch_field");
    }
  }
  const reply = await forward(request);
  await invalidateOwned(request.ctx);
  return relay(reply);
};

const patchVoice: Handler = async (request) => {
  ownedNonStanding(request);
  const body = request.body;
  if (!body) throw new Refusal("request.body_invalid");
  // Call forwarding and number translation are absent on purpose: either
  // would send a call into a test number on to any phone at all.
  if (!Object.keys(body).every((field) => VOICE_PATCH_FIELDS.has(field))) throw new Refusal("provisioning.patch_field");
  return relay(await forward(request));
};

const deleteNumber: Handler = async (request) => {
  ownedNonStanding(request);
  const reply = await forward(request, undefined);
  await invalidateOwned(request.ctx);
  return relay(reply);
};

const ALLOWED_DESTINATIONS = new Set(SPEC.messaging_profiles.whitelisted_destinations);

const createMessagingProfile: Handler = async (request) => {
  const { ctx, view } = request;
  const body = request.body;
  if (!body) throw new Refusal("request.body_invalid");
  const pending = (await ctx.store.get<number>("profiles:pending")) ?? 0;
  if (view.messagingProfiles.size + pending >= SPEC.messaging_profiles.max_profiles) {
    throw new Refusal("provisioning.profile_count");
  }
  const limit = Number(body.daily_spend_limit);
  if (
    body.daily_spend_limit_enabled !== true ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    limit > Number(SPEC.messaging_profiles.max_daily_spend_limit)
  ) {
    throw new Refusal("provisioning.profile_spend_limit");
  }
  const whitelist = body.whitelisted_destinations;
  if (
    !Array.isArray(whitelist) ||
    whitelist.length === 0 ||
    !whitelist.every((code) => typeof code === "string" && ALLOWED_DESTINATIONS.has(code))
  ) {
    throw new Refusal("provisioning.profile_whitelist");
  }
  if (!onEdge(ctx, body.webhook_url)) throw new Refusal("provisioning.profile_webhook");
  for (const field of ["webhook_failover_url", "health_webhook_url"]) {
    if (body[field] !== undefined && body[field] !== null && !onEdge(ctx, body[field])) {
      throw new Refusal("provisioning.profile_webhook");
    }
  }

  await ctx.store.put("profiles:pending", pending + 1);
  try {
    const reply = await forward(request);
    const id = (reply.body as { data?: { id?: unknown } } | undefined)?.data?.id;
    if (isOk(reply) && typeof id === "string") {
      const known = (await ctx.store.get<string[]>(KEYS.appProfiles)) ?? [];
      await ctx.store.put(KEYS.appProfiles, [...new Set([...known, id])].sort());
    }
    return relay(reply);
  } finally {
    const now = (await ctx.store.get<number>("profiles:pending")) ?? 1;
    await ctx.store.put("profiles:pending", Math.max(0, now - 1));
  }
};

/** Credentials on a connection, from Telnyx's own listing: the store may not know them all. */
async function credentialsOn(ctx: Ctx, connectionId: string): Promise<number> {
  const items = await ctx.telnyx!.listAll<Item>("/v2/telephony_credentials", {
    "filter[resource_id]": `connection:${connectionId}`,
  });
  return items.filter((item) => connectionOfResource(item.resource_id) === connectionId).length;
}

const createCredential: Handler = async (request) => {
  const { ctx, view } = request;
  const body = request.body;
  if (!body) throw new Refusal("request.body_invalid");
  const { webrtc, sentinel } = view.record.connections;
  const connection = body.connection_id;
  if (typeof connection !== "string" || (connection !== webrtc && connection !== sentinel)) {
    throw new Refusal("provisioning.credential_connection");
  }
  if (connection === sentinel && (await credentialsOn(ctx, sentinel)) >= sentinelCredentialCap()) {
    throw new Refusal("provisioning.sentinel_full");
  }
  const day = dayOf(ctx.now());
  if (!(await tryTake(ctx, "credentials", day, 1, CREDENTIALS_PER_DAY))) throw new Refusal("budget.credentials_day");

  const reply = await forward(request);
  if (isDefiniteFailure(reply)) await giveBack(ctx, "credentials", day, 1);
  const data = (reply.body as { data?: Item } | undefined)?.data;
  if (isOk(reply) && data && typeof data.id === "string") {
    await rememberCredential(ctx, {
      id: data.id,
      connection_id: connection,
      sip_username: typeof data.sip_username === "string" ? data.sip_username : null,
      created_at: ctx.now(),
    });
  }
  return relay(reply);
};

async function requireNonprodCredential(request: TelnyxRequest): Promise<CredentialRecord> {
  const record = await credentialById(request.ctx, request.ids[0]);
  const { webrtc, sentinel } = request.view.record.connections;
  if (!record || record.deleted_at || (record.connection_id !== webrtc && record.connection_id !== sentinel)) {
    throw new Refusal("provisioning.credential_not_nonprod");
  }
  return record;
}

const deleteCredential: Handler = async (request) => {
  const record = await requireNonprodCredential(request);
  const reply = await forward(request, undefined);
  if (isOk(reply) || reply.status === 404) {
    await request.ctx.store.put(`${CREDENTIAL_PREFIX}${record.id}`, { ...record, deleted_at: request.ctx.now() });
  }
  return relay(reply);
};

const credentialToken: Handler = async (request) => {
  await requireNonprodCredential(request);
  return relay(await forward(request, undefined));
};

export const PROVISIONING_HANDLERS: Readonly<Record<string, Handler>> = {
  "GET /v2/available_phone_numbers": search,
  "POST /v2/number_orders": order,
  "PATCH /v2/phone_numbers/:id": patchNumber,
  "DELETE /v2/phone_numbers/:id": deleteNumber,
  "PATCH /v2/phone_numbers/:id/voice": patchVoice,
  "POST /v2/messaging_profiles": createMessagingProfile,
  "POST /v2/telephony_credentials": createCredential,
  "DELETE /v2/telephony_credentials/:id": deleteCredential,
  "POST /v2/telephony_credentials/:id/token": credentialToken,
};

export const handleProvisioning: Handler = async (request) => {
  const handler = PROVISIONING_HANDLERS[request.entry.key];
  if (!handler) throw new Refusal("registry.missing");
  return handler(request);
};
