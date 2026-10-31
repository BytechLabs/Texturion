import { COST_USD, DIALS_PER_DAY, DIALS_PER_HOUR } from "../limits";
import { Refusal } from "../refusal";
import { admitPaid } from "../state/admission";
import { dayOf, giveBack, hourOf, tryTake } from "../state/counters";
import { requireLeaseHeader } from "../state/lease";
import { charge, refund } from "../state/ledger";
import { liveLeg, registerLeg } from "../state/legs";
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

export const handleDial: Handler = async (request) => {
  const { ctx } = request;
  if (!request.body) throw new Refusal("request.body_invalid");
  const lease = await requireLeaseHeader(ctx, request.lease);
  const shape = await shapeOf(request);
  await admitPaid(ctx, request.view, { newLegs: shape.newLegs, scenario: lease.scenario });

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
