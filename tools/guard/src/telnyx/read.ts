import { EDGE_PATHS } from "@loonext/rig-protocol";

import { Refusal } from "../refusal";
import { liveLease } from "../state/lease";
import { liveLeg } from "../state/legs";
import { forward, relay } from './forward';
import type { Handler, TelnyxRequest } from './forward';

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
  /** Removes fields that are unnecessary for judging a scoped read. */
  project?(item: Item, request: TelnyxRequest): unknown;
}

type DeliveryAttempt = {
  started_at?: unknown;
  http?: { request?: { url?: unknown }; response?: { status?: unknown } };
};

type DeliveryWebhook = {
  id?: unknown;
  event_type?: unknown;
  payload?: { connection_id?: unknown };
};

function voiceAttempts(item: Item, edgeOrigin: string | null) {
  if (!edgeOrigin || !Array.isArray(item.attempts)) return [];
  const primary = edgeOrigin + EDGE_PATHS.telnyxVoice;
  const failover = edgeOrigin + EDGE_PATHS.telnyxVoiceFailover;
  return (item.attempts as DeliveryAttempt[]).filter((attempt) => {
    const url = attempt?.http?.request?.url;
    return url === primary || url === failover;
  });
}

function requireOneFilter(request: TelnyxRequest, names: readonly string[]): void {
  if (!names.some((name) => request.query.get(`filter[${name}]`))) throw new Refusal("read.filter_required");
}

const inGroup = (item: Item, request: TelnyxRequest) =>
  item.billing_group_id === request.view.record.billing_group_id;

export const READ_RULES: Readonly<Record<string, ReadRule>> = {
  "GET /v2/phone_numbers": {
    async prepare(request) {
      for (const name of Array.from(request.query.keys())) {
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
  "GET /v2/webhook_deliveries": {
    async prepare(request) {
      const lease = await liveLease(request.ctx);
      const edge = request.ctx.config.edgeOrigin;
      if (request.caller !== "robot" || lease?.scenario !== "S17" || !edge) {
        throw new Refusal("read.filter_not_nonprod");
      }
      const since = Date.parse(request.query.get("filter[started_at][gte]") ?? "");
      if (!Number.isFinite(since)) throw new Refusal("read.filter_required");
      request.query = new URLSearchParams({
        "filter[started_at][gte]": new Date(Math.max(since, lease.acquired_at)).toISOString(),
        "filter[attempts][contains]": edge + EDGE_PATHS.telnyxVoice,
      });
    },
    keep(item, request) {
      const webhook = item.webhook as DeliveryWebhook | undefined;
      const connectionId = webhook?.payload?.connection_id;
      const since = Date.parse(request.query.get("filter[started_at][gte]") ?? "");
      return typeof item.started_at === "string" && Date.parse(item.started_at) >= since &&
        typeof webhook?.event_type === "string" && webhook.event_type.startsWith("call.") &&
        typeof connectionId === "string" && request.view.connections.has(connectionId) &&
        voiceAttempts(item, request.ctx.config.edgeOrigin).length > 0;
    },
    project(item, request) {
      const webhook = item.webhook as DeliveryWebhook;
      return {
        id: item.id,
        status: item.status,
        webhook: { id: webhook.id, event_type: webhook.event_type },
        attempts: voiceAttempts(item, request.ctx.config.edgeOrigin).map((attempt) => ({
          started_at: attempt.started_at,
          http: {
            request: { url: attempt.http?.request?.url },
            response: { status: attempt.http?.response?.status },
          },
        })),
      };
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
      if (item && typeof item === "object" && (await rule.keep(item as Item, request))) {
        kept.push(rule.project ? rule.project(item as Item, request) : item);
      }
    }
    return relay(reply, rule.project ? { data: kept } : { ...body, data: kept });
  }
  if (!rule.project && body.data && typeof body.data === "object" && (await rule.keep(body.data as Item, request))) {
    return relay(reply, body);
  }
  throw new Refusal("read.not_in_partition");
};
