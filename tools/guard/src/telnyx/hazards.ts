import type { Ctx } from "../context";
import { liveLeg } from "../state/legs";

/**
 * Body fields that reach past the leg a command names, checked on every
 * dial, transfer, bridge and leg command. Each one is a way for an allowed
 * request to touch something outside the partition:
 *   - another call (`link_to`, `supervise_call_control_id`, `call_control_id`
 *     on a bridge) must be a registered leg, or the rig could listen to or
 *     join a production call;
 *   - a conference, queue or video room is account-wide, and joining one by
 *     name or id would join production's;
 *   - a webhook or media stream override sends the call's events or audio to
 *     a host of the caller's choosing, so it must be the edge;
 *   - an AI assistant or Dialogflow agent is spend and an external URL;
 *   - SIP auth is only for a call off the account;
 *   - a billing group other than the partition's would bill a leg outside it.
 */
const ALWAYS_REFUSED = [
  "conference_config",
  "queue",
  "video_room_id",
  "video_room_context",
  "assistant",
  "conversation_relay_config",
  "enable_dialogflow",
  "dialogflow_config",
  "sip_auth_username",
  "sip_auth_password",
] as const;

const LEG_REFERENCES = ["link_to", "supervise_call_control_id"] as const;
const EDGE_URLS = ["webhook_url", "webhook_failover_url", "stream_url"] as const;

export function onEdge(ctx: Pick<Ctx, "config">, value: unknown): boolean {
  if (typeof value !== "string" || !ctx.config.edgeOrigin) return false;
  try {
    return new URL(value).origin === ctx.config.edgeOrigin;
  } catch {
    return false;
  }
}

/** True when the body carries none of the hazards above, or only safe values for them. */
export async function bodyIsContained(
  ctx: Ctx,
  body: Record<string, unknown>,
  billingGroupId: string,
): Promise<boolean> {
  for (const field of ALWAYS_REFUSED) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== false) return false;
  }
  for (const field of LEG_REFERENCES) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !(await liveLeg(ctx, value))) return false;
  }
  for (const field of EDGE_URLS) {
    const value = body[field];
    if (value !== undefined && value !== null && !onEdge(ctx, value)) return false;
  }
  const many = body.webhook_urls;
  if (many !== undefined && many !== null) {
    if (typeof many !== "object" || Array.isArray(many)) return false;
    if (!Object.values(many).every((value) => onEdge(ctx, value))) return false;
  }
  const group = body.billing_group_id;
  if (group !== undefined && group !== null && group !== billingGroupId) return false;
  return true;
}
