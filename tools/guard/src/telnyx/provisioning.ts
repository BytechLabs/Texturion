import { NUMBER_SCENARIO, SEARCH_SCENARIOS } from "../limits";
import { Refusal } from "../refusal";
import { SPEC } from "../setup/spec";
import { liveLease } from "../state/lease";
import { forward, isOk, relay } from './forward';
import type { Handler, TelnyxRequest } from './forward';
import { onEdge } from "./hazards";
import { noteOrder, requireOrdering, verifyFirstOrder } from "./ordering";
import { invalidateOwned, isStanding, KEYS } from './partition';
import type { OwnedNumber } from './partition';
import { CREDENTIAL_PREFIX, credentialById, isE164, rememberCredential } from './targets';
import type { CredentialRecord } from './targets';

/**
 * The provisioning class (docs/RIG.md): an explicit list, each
 * entry scoped to nonprod resources.
 */
type Item = Record<string, unknown>;

const search: Handler = async (request) => {
  const { ctx } = request;
  const lease = await liveLease(ctx);
  if (!lease || !SEARCH_SCENARIOS.includes(lease.scenario)) throw new Refusal("provisioning.search_needs_lease");
  return relay(await forward(request, undefined));
};

export function checkOrderBody(view: TelnyxRequest["view"], body: Item): { body: Item; phoneNumber: string } {
  const numbers = body.phone_numbers;
  if (!Array.isArray(numbers) || numbers.length !== 1 || !isE164((numbers[0] as Item | undefined)?.phone_number)) {
    throw new Refusal("provisioning.order_one_number");
  }
  if (body.billing_group_id !== view.record.billing_group_id) throw new Refusal("provisioning.order_group");
  if (typeof body.messaging_profile_id !== "string" || !view.messagingProfiles.has(body.messaging_profile_id)) {
    throw new Refusal("provisioning.order_profile");
  }
  const phoneNumber = (numbers[0] as Item).phone_number as string;
  // The app binds voice after the order, so its order body has no
  // connection. An order must carry one, so the guard adds the
  // voice app rather than letting a number land unbound.
  const connection = body.connection_id ?? view.record.connections.voice;
  if (typeof connection !== "string" || !view.dialConnections.has(connection)) {
    throw new Refusal("provisioning.order_connection");
  }
  return { body: { ...body, connection_id: connection }, phoneNumber };
}

const order: Handler = async (request) => {
  const { ctx } = request;
  if (!request.body) throw new Refusal("request.body_invalid");
  await verifyFirstOrder(ctx);
  await requireOrdering(ctx);
  const lease = await liveLease(ctx);
  if (!lease || lease.scenario !== NUMBER_SCENARIO) throw new Refusal("provisioning.order_needs_lease");
  const checked = checkOrderBody(request.view, request.body);
  const reply = await forward(request, checked.body);
  if (isOk(reply)) {
    const id = (reply.body as { data?: { id?: unknown } } | undefined)?.data?.id;
    const profile = checked.body.messaging_profile_id as string;
    await noteOrder(ctx, typeof id === "string" ? id : null, checked.phoneNumber, {
      messaging_profile_id: profile,
      connection_id: typeof checked.body.connection_id === "string" ? checked.body.connection_id : null,
    });
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
const VOICE_PATCH_FIELDS = new Set(["caller_id_name_enabled", "cnam_listing", "inbound_call_screening"]);

const patchNumber: Handler = async (request) => {
  ownedNonStanding(request);
  const {body} = request;
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
  const {body} = request;
  if (!body) throw new Refusal("request.body_invalid");
  // Call forwarding and number translation are absent on purpose: either
  // would send a call into a test number on to any phone at all.
  if (!Object.keys(body).every((field) => VOICE_PATCH_FIELDS.has(field))) throw new Refusal("provisioning.patch_field");
  if ("inbound_call_screening" in body && body.inbound_call_screening !== "disabled" && body.inbound_call_screening !== "flag_calls") {
    throw new Refusal("provisioning.patch_field");
  }
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
  const { ctx } = request;
  const {body} = request;
  if (!body) throw new Refusal("request.body_invalid");
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

  const reply = await forward(request, { ...body, daily_spend_limit_enabled: false });
  const id = (reply.body as { data?: { id?: unknown } } | undefined)?.data?.id;
  if (isOk(reply) && typeof id === "string") {
    const known = (await ctx.store.get<string[]>(KEYS.appProfiles)) ?? [];
    await ctx.store.put(KEYS.appProfiles, [...new Set([...known, id])].toSorted());
  }
  return relay(reply);
};

const createCredential: Handler = async (request) => {
  const { ctx, view } = request;
  const {body} = request;
  if (!body) throw new Refusal("request.body_invalid");
  const { webrtc, sentinel } = view.record.connections;
  const connection = body.connection_id;
  if (typeof connection !== "string" || (connection !== webrtc && connection !== sentinel)) {
    throw new Refusal("provisioning.credential_connection");
  }
  const reply = await forward(request);
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
