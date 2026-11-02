import { Refusal } from "../refusal";
import { liveLeg } from "../state/legs";
import { forward, relay, type Handler, type TelnyxRequest } from "./forward";

/**
 * The read class (docs/RIG.md). Each registered GET has a rule:
 * what the request must carry or is forced to carry, and which items of the
 * answer may go back. Every answer is filtered again, whatever filter was
 * sent, because a filter Telnyx ignores would otherwise return the account.
 * A GET with no rule here is refused: there is no generic way to know what a
 * new endpoint's answer belongs to.
 */
type Item = Record<string, unknown>;

interface ReadRule {
  /** Forces filters or refuses before anything is asked of Telnyx. */
  prepare?(request: TelnyxRequest): Promise<void>;
  keep(item: Item, request: TelnyxRequest): Promise<boolean> | boolean;
}

function requireOneFilter(request: TelnyxRequest, names: readonly string[]): void {
  if (!names.some((name) => request.query.get(`filter[${name}]`))) throw new Refusal("read.filter_required");
}

const inGroup = (item: Item, request: TelnyxRequest) =>
  item.billing_group_id === request.view.record.billing_group_id;

/** A read of one partition resource by id: refused before Telnyx is asked unless the id is one of `ids`. */
function onePartitionResource(ids: (request: TelnyxRequest) => (string | null)[]): ReadRule {
  return {
    async prepare(request) {
      if (!ids(request).includes(request.ids[0])) throw new Refusal("read.not_in_partition");
    },
    keep: (item, request) => item.id === request.ids[0],
  };
}

/** A webhook delivery is kept only when the event it carried names a nonprod connection or profile. */
function deliveryInPartition(item: Item, request: TelnyxRequest): boolean {
  const webhook = item.webhook as { payload?: Item } | undefined;
  const payload = webhook?.payload ?? {};
  const { connections, messagingProfiles } = request.view;
  return (
    (typeof payload.connection_id === "string" && connections.has(payload.connection_id)) ||
    (typeof payload.messaging_profile_id === "string" && messagingProfiles.has(payload.messaging_profile_id))
  );
}

export const READ_RULES: Readonly<Record<string, ReadRule>> = {
  "GET /v2/phone_numbers": {
    async prepare(request) {
      for (const name of [...request.query.keys()]) {
        if (name.startsWith("filter[billing_group_id]")) request.query.delete(name);
      }
      request.query.set("filter[billing_group_id]", request.view.record.billing_group_id);
    },
    keep: inGroup,
  },
  "GET /v2/phone_numbers/:id": { keep: inGroup },
  "GET /v2/phone_numbers/:id/voice": {
    async prepare(request) {
      if (!request.view.byId.has(request.ids[0])) throw new Refusal("read.not_in_partition");
    },
    keep: (item, request) => item.id === request.ids[0],
  },
  "GET /v2/number_orders/:id": { keep: inGroup },
  "GET /v2/calls/:id": {
    async prepare(request) {
      if (!(await liveLeg(request.ctx, request.ids[0]))) throw new Refusal("read.leg_not_registered");
    },
    keep: (item, request) => item.call_control_id === undefined || item.call_control_id === request.ids[0],
  },
  "GET /v2/recordings": {
    async prepare(request) {
      requireOneFilter(request, ["call_session_id", "call_control_id", "call_leg_id"]);
    },
    async keep(item, request) {
      if (typeof item.connection_id === "string" && request.view.connections.has(item.connection_id)) return true;
      return typeof item.call_control_id === "string" && (await liveLeg(request.ctx, item.call_control_id)) !== null;
    },
  },
  "GET /v2/messaging_optouts": {
    async prepare(request) {
      const profile = request.query.get("filter[messaging_profile_id]");
      if (!profile) throw new Refusal("read.filter_required");
      if (!request.view.messagingProfiles.has(profile)) throw new Refusal("read.filter_not_nonprod");
    },
    keep: (item, request) =>
      typeof item.messaging_profile_id === "string" && request.view.messagingProfiles.has(item.messaging_profile_id),
  },

  // Production's own wiring watches (PW01) register these, and production
  // alone runs them; from the rig, each answers for the partition only.
  "GET /v2/call_control_applications/:id": onePartitionResource(({ view }) => [
    view.record.connections.voice,
    view.record.connections.robot,
  ]),
  "GET /v2/credential_connections/:id": onePartitionResource(({ view }) => [
    view.record.connections.webrtc,
    view.record.connections.sentinel,
  ]),
  // #642: the daily spend limit on production's own outbound voice profile.
  // From the rig it answers for the partition's profiles only.
  "GET /v2/outbound_voice_profiles/:id": onePartitionResource(({ view }) =>
    Object.values(view.record.outbound_voice_profiles ?? {}),
  ),
  "GET /v2/messaging_profiles": {
    keep: (item, request) => typeof item.id === "string" && request.view.messagingProfiles.has(item.id),
  },
  "GET /v2/webhook_deliveries": { keep: deliveryInPartition },
};

export const handleRead: Handler = async (request) => {
  const rule = READ_RULES[request.entry.key];
  if (!rule) throw new Refusal("read.no_filter_rule");
  await rule.prepare?.(request);

  const reply = await forward(request, undefined);
  if (reply.status !== 200) return relay(reply);
  const body = reply.body as { data?: unknown } | undefined;
  if (!body || typeof body !== "object") throw new Refusal("read.not_in_partition");

  if (Array.isArray(body.data)) {
    const kept: unknown[] = [];
    for (const item of body.data) {
      if (item && typeof item === "object" && (await rule.keep(item as Item, request))) kept.push(item);
    }
    return relay(reply, { ...body, data: kept });
  }
  if (body.data && typeof body.data === "object" && (await rule.keep(body.data as Item, request))) {
    return relay(reply, body);
  }
  throw new Refusal("read.not_in_partition");
};
