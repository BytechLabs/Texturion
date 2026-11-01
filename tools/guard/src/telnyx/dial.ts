import { COST_USD, DIALS_PER_DAY, DIALS_PER_HOUR } from "../limits";
import { Refusal } from "../refusal";
import { admitPaid, type Admitted } from "../state/admission";
import { recordCeiling } from "../state/concurrency";
import { dayOf, giveBack, hourOf, tryTake } from "../state/counters";
import { requireDialLease } from "../state/lease";
import { charge, refund } from "../state/ledger";
import { liveLeg, registerLeg } from "../state/legs";
import { recordSignal } from "../state/signals";
import type { TelnyxReply } from "./client";
import { enforceCap } from "./detach";
import { forward, isDefiniteFailure, isOk, relay, type Handler, type TelnyxRequest } from "./forward";
import { bodyIsContained } from "./hazards";
import { isAllowedCallTarget, isOwnedNumber } from "./targets";

/**
 * Dial, transfer and bridge (docs/RIG.md). Each connects a leg to somebody,
 * so each is checked like a new call: a live run lease, a nonprod connection,
 * owned numbers or a rig SIP user at both ends, nothing in the body that
 * reaches past the partition, and admission (room, window, ratios, money).
 */
interface Shape {
  newLegs: number;
  costUsd: number;
  /** The connection a new leg is placed on, for registering the leg it creates. */
  connectionId: string | null;
}

async function shapeOf(request: TelnyxRequest): Promise<Shape> {
  const { ctx, view } = request;
  const body = request.body as Record<string, unknown>;
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
      if (!(await isAllowedCallTarget(ctx, view, target))) throw new Refusal("dial.to_not_owned");
    }
    if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
    return { newLegs: targets.length, costUsd: COST_USD.dial * targets.length, connectionId: connection };
  }

  if (!(await liveLeg(ctx, request.ids[0]))) throw new Refusal("dial.leg_not_registered");

  if (request.entry.key === "POST /v2/calls/:id/actions/transfer") {
    if (!(await isAllowedCallTarget(ctx, view, body.to))) throw new Refusal("dial.to_not_owned");
    if (body.from !== undefined && !isOwnedNumber(view, body.from)) throw new Refusal("dial.from_not_owned");
    if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
    return { newLegs: 1, costUsd: COST_USD.transfer, connectionId: null };
  }

  // Bridge: both legs must be registered; it joins two calls and adds none.
  const other = body.call_control_id;
  if (typeof other !== "string" || !(await liveLeg(ctx, other))) throw new Refusal("dial.leg_not_registered");
  if (!(await bodyIsContained(ctx, body, group))) throw new Refusal("dial.field_refused");
  return { newLegs: 0, costUsd: 0, connectionId: null };
}

/**
 * Telnyx's documented refusals for the account's limits
 * (developers.telnyx.com/api/errors): channels exceeded on the account, the
 * voice profile or the connection, and dials per second with HTTP 429.
 */
const CONCURRENCY_CODES: ReadonlySet<string> = new Set(["90041", "90042", "90043"]);
const DIAL_RATE_CODE = "90103";

function errorCodes(reply: TelnyxReply): string[] {
  const errors = (reply.body as { errors?: { code?: unknown }[] } | undefined)?.errors;
  return Array.isArray(errors) ? errors.map((error) => String(error?.code ?? "")) : [];
}

/**
 * A refusal for a limit is the account's own answer about that limit. It
 * records a ceiling and halts the paid lanes like an account signal. The
 * ceiling has a value only when production was idle at admission: then every
 * leg up was the rig's, and the account refused one more than it allows.
 */
async function noteLimitRefusal(request: TelnyxRequest, reply: TelnyxReply, shape: Shape, admitted: Admitted): Promise<void> {
  const codes = errorCodes(reply);
  const concurrency = codes.find((code) => CONCURRENCY_CODES.has(code));
  const rate = reply.status === 429 && codes.includes(DIAL_RATE_CODE);
  if (!concurrency && !rate) return;
  const { ctx } = request;
  const code = concurrency ?? DIAL_RATE_CODE;
  if (concurrency) {
    const counted = admitted.production === "idle" && admitted.liveLegs !== null;
    await recordCeiling(ctx, {
      value: counted ? (admitted.liveLegs as number) + shape.newLegs - 1 : null,
      from: `telnyx-${code}`,
    });
  }
  await recordSignal(ctx, {
    signal: concurrency ? "telnyx-concurrency-refusal" : "telnyx-dial-rate-refusal",
    notice_id: null,
    corroborated_by: "guard",
  });
}

export const handleDial: Handler = async (request) => {
  const { ctx } = request;
  if (!request.body) throw new Refusal("request.body_invalid");
  const lease = await requireDialLease(ctx, request.lease, request.caller);
  const shape = await shapeOf(request);
  const admitted = await admitPaid(ctx, request.view, { newLegs: shape.newLegs, scenario: lease.scenario });

  const day = dayOf(ctx.now());
  const hour = hourOf(ctx.now());
  if (shape.newLegs > 0) {
    if (!(await tryTake(ctx, "dials", day, shape.newLegs, DIALS_PER_DAY))) throw new Refusal("budget.dials_day");
    if (!(await tryTake(ctx, "dials-hour", hour, shape.newLegs, DIALS_PER_HOUR))) {
      await giveBack(ctx, "dials", day, shape.newLegs);
      throw new Refusal("budget.dials_hour");
    }
  }
  if (shape.costUsd > 0) await charge(ctx, shape.costUsd);

  const reply = await forward(request);
  await noteLimitRefusal(request, reply, shape, admitted);
  if (isDefiniteFailure(reply)) {
    if (shape.newLegs > 0) {
      await giveBack(ctx, "dials", day, shape.newLegs);
      await giveBack(ctx, "dials-hour", hour, shape.newLegs);
    }
    if (shape.costUsd > 0) await refund(ctx, shape.costUsd);
  }
  if (isOk(reply) && shape.connectionId) {
    const ccid = (reply.body as { data?: { call_control_id?: unknown } } | undefined)?.data?.call_control_id;
    if (typeof ccid === "string" && ccid) {
      await registerLeg(ctx, {
        call_control_id: ccid,
        connection_id: shape.connectionId,
        via: shape.connectionId === request.view.record.connections.robot ? "robot" : "voice",
      });
    }
  }
  await enforceCap(ctx, request.view);
  return relay(reply);
};
