import { Refusal } from "../refusal";
import { requireDialLease } from "../state/lease";
import { liveLeg, registerLeg } from "../state/legs";
import { forward, isOk, relay } from './forward';
import type { Handler, TelnyxRequest } from './forward';
import { bodyIsContained } from "./hazards";
import { isAllowedCallTarget, isOwnedNumber } from "./targets";

const QA_IVR_HANGUP_MS = 15_000;

/**
 * Dial, transfer and bridge (docs/RIG.md). Each connects a leg to somebody,
 * so each is checked like a new call: a live run lease, a nonprod connection,
 * owned numbers or a rig SIP user at both ends, and contained body fields.
 * The optional S01 IVR is the one external voice destination.
 */
async function validateDial(request: TelnyxRequest, qaIvr: boolean): Promise<string | null> {
  const { ctx, view } = request;
  const body = request.body!;
  const group = view.record.billing_group_id;

  if (request.entry.key === "POST /v2/calls") {
    const connection = body.connection_id;
    if (typeof connection !== "string" || !view.dialConnections.has(connection)) {
      throw new Refusal("dial.connection_not_nonprod");
    }
    if (!isOwnedNumber(view, body.from)) throw new Refusal("dial.from_not_owned");
    const targets = Array.isArray(body.to) ? body.to : [body.to];
    if (targets.length === 0) throw new Refusal("dial.to_not_owned");
    for (const target of targets) {
      if (!qaIvr && !(await isAllowedCallTarget(ctx, view, target))) throw new Refusal("dial.to_not_owned");
    }
    if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
    return connection;
  }

  if (!(await liveLeg(ctx, request.ids[0]))) throw new Refusal("dial.leg_not_registered");

  if (request.entry.key === "POST /v2/calls/:id/actions/transfer") {
    if (!(await isAllowedCallTarget(ctx, view, body.to))) throw new Refusal("dial.to_not_owned");
    if (body.from !== undefined && !isOwnedNumber(view, body.from)) throw new Refusal("dial.from_not_owned");
    if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
    return null;
  }

  // Bridge: both legs must be registered; it joins two calls and adds none.
  const other = body.call_control_id;
  if (typeof other !== "string" || !(await liveLeg(ctx, other))) throw new Refusal("dial.leg_not_registered");
  if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
  return null;
}

export const handleDial: Handler = async (request) => {
  const { ctx, body } = request;
  if (!body) throw new Refusal("request.body_invalid");
  const lease = await requireDialLease(ctx, request.lease, request.caller);
  const qaIvr = ctx.config.qaTollFreeCall !== null && request.caller === "rig-api" && lease.scenario === "S01" &&
    request.entry.key === "POST /v2/calls" && body.connection_id === request.view.record.connections.voice &&
    body.to === ctx.config.qaTollFreeCall && body.sip_address === undefined;
  if (qaIvr && (body.send_digits_on_answer || body.audio_url || body.media_name || !ctx.waitUntil)) {
    throw new Refusal("dial.field_refused");
  }
  const connectionId = await validateDial(request, qaIvr);
  const reply = qaIvr
    ? await forward({ ...request, idempotencyKey: lease.lease_id }, {
      ...body,
      timeout_secs: 10,
      retry_on_timeout: false,
      // Telnyx's shortest carrier-side limit backs up the 15-second hangup.
      time_limit_secs: 30,
      command_id: lease.lease_id,
    })
    : await forward(request);
  if (isOk(reply) && connectionId) {
    const ccid = (reply.body as { data?: { call_control_id?: unknown } } | undefined)?.data?.call_control_id;
    if (typeof ccid === "string" && ccid) {
      if (qaIvr) {
        ctx.waitUntil?.(ctx.sleep(QA_IVR_HANGUP_MS).then(() =>
          ctx.telnyx!.send("POST", `/v2/calls/${encodeURIComponent(ccid)}/actions/hangup`, {}),
        ));
      }
      await registerLeg(ctx, {
        call_control_id: ccid,
        connection_id: connectionId,
        via: connectionId === request.view.record.connections.robot ? "robot" : "voice",
      });
    }
  }
  return relay(reply);
};
