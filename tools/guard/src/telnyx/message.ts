import { CORE_SCENARIOS, COST_USD, TEXTS_PER_DAY, TEXTS_PER_MONTH } from "../limits";
import { Refusal } from "../refusal";
import { requireAboveFloor } from "../state/balance";
import { dayOf, giveBack, monthOf, tryTake } from "../state/counters";
import { liveLease } from "../state/lease";
import { charge, readTier, refund } from "../state/ledger";
import { requirePaidLanesOpen } from "../state/signals";
import { enforceCap } from "./detach";
import { forward, isDefiniteFailure, relay, type Handler } from "./forward";
import { onEdge } from "./hazards";
import { isOwnedNumber } from "./targets";

/**
 * The message class (docs/RIG.md): `from` and `to` both owned,
 * on a nonprod messaging profile, so every test text stays on-net between
 * numbers the rig holds.
 */

/**
 * Plain GSM-7 characters only. Anything else, the extension table included,
 * is counted as UCS-2, which can only overestimate the parts.
 */
const GSM = /^[\n\r A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@_]*$/;

/** SMS parts for a body: 160/153 characters in GSM-7, 70/67 otherwise. */
export function smsParts(text: string): number {
  const gsm = GSM.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const length = [...text].length;
  return length <= single ? 1 : Math.ceil(length / multi);
}

/** An MMS is priced as four text parts on each end, which covers Telnyx's MMS rate. */
const MMS_PARTS = 4;

export function messageCostUsd(body: Record<string, unknown>): number {
  const media = Array.isArray(body.media_urls) && body.media_urls.length > 0;
  const text = typeof body.text === "string" ? body.text : "";
  return (media ? MMS_PARTS : smsParts(text)) * COST_USD.textPart;
}

export const handleMessage: Handler = async (request) => {
  const { ctx, view } = request;
  const body = request.body;
  if (!body) throw new Refusal("request.body_invalid");

  if (!isOwnedNumber(view, body.from)) throw new Refusal("message.from_not_owned");
  const targets = Array.isArray(body.to) ? body.to : [body.to];
  if (targets.length === 0 || !targets.every((to) => isOwnedNumber(view, to))) {
    throw new Refusal("message.to_not_owned");
  }
  const sender = view.byE164.get(body.from as string);
  const profiles = [sender?.messaging_profile_id ?? null, body.messaging_profile_id ?? null].filter(
    (value) => value !== null,
  );
  if (profiles.length === 0 || !profiles.every((id) => typeof id === "string" && view.messagingProfiles.has(id))) {
    throw new Refusal("message.profile_not_nonprod");
  }
  for (const field of ["webhook_url", "webhook_failover_url"]) {
    if (body[field] !== undefined && body[field] !== null && !onEdge(ctx, body[field])) {
      throw new Refusal("message.field_refused");
    }
  }

  await requirePaidLanesOpen(ctx);
  const tier = await readTier(ctx);
  if (tier.tier === "red") throw new Refusal("budget.tier_red");
  if (tier.tier === "amber") {
    // The live lease's scenario, never one the caller names: the scenario
    // header is the caller's own claim.
    const scenario = (await liveLease(ctx))?.scenario ?? null;
    if (!scenario || !CORE_SCENARIOS.includes(scenario)) throw new Refusal("budget.tier_amber");
  }
  await requireAboveFloor(ctx);

  const day = dayOf(ctx.now());
  const month = monthOf(ctx.now());
  if (!(await tryTake(ctx, "texts", day, targets.length, TEXTS_PER_DAY))) throw new Refusal("budget.texts_day");
  if (!(await tryTake(ctx, "texts-month", month, targets.length, TEXTS_PER_MONTH))) {
    await giveBack(ctx, "texts", day, targets.length);
    throw new Refusal("budget.texts_month");
  }
  const cost = messageCostUsd(body) * targets.length;
  await charge(ctx, cost);

  const reply = await forward(request);
  if (isDefiniteFailure(reply)) {
    await giveBack(ctx, "texts", day, targets.length);
    await giveBack(ctx, "texts-month", month, targets.length);
    await refund(ctx, cost);
  }
  await enforceCap(ctx, view);
  return relay(reply);
};
