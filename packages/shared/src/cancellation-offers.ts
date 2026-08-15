/**
 * #277 follow-up — answering the reason somebody gave for leaving, once.
 *
 * # What this is
 *
 * The cancel card asks why, records the answer, and then says nothing back. Six
 * reasons, and for three of them we have a true and useful thing to say that the
 * person has no way of knowing. This module is that answer, and ONLY that
 * answer: a heading, a body, and an optional action naming a control the client
 * already has on the same screen.
 *
 * # What it is deliberately not
 *
 * NOT A RETENTION FUNNEL, and the constraint is hard rather than tasteful.
 * `cancel-subscription-card` ships open on all three clients precisely so that
 * somebody who answers nothing reaches Stripe in ONE action, because cancelling
 * may never take more steps than subscribing did. Nothing here may be rendered
 * in a way that adds a step: the offer appears in place, under an answer the
 * person chose to give, and the exit stays exactly where it was.
 *
 * NOT A PLACE TO INVENT AN OFFER. Every sentence below is checkable in this
 * repository, and the three reasons that return null return null because we have
 * nothing honest to say — not because the copy has not been written yet:
 *
 *   too_expensive on starter  There is no cheaper plan. PLAN_PRICE_CENTS has
 *                             two entries and starter is the smaller one.
 *                             Inventing one is the dishonesty #277 forbids.
 *   switched                  We do not know what they switched to, and a
 *                             rebuttal written against a competitor we are
 *                             guessing at is an argument, which this is not.
 *   not_using / other         The export and the exit are already on the card
 *                             and are what those answers actually need.
 *
 * # #277's paid pause, and the two answers it changes
 *
 * The pause exists now, and this file predates it: a licensed-price swap that
 * holds the number and the whole history for a small monthly fee, with no clock
 * on it (`apps/api/src/billing/pause.ts`).
 *
 * WHETHER A PAUSE IS ON OFFER IS NOT KNOWABLE HERE. Eligibility is a Stripe read
 * `GET /v1/billing/pause` owns, and it refuses a workspace with a prepaid year,
 * an unconsumed referral month, a pending plan change, an unhealthy card or an
 * unprovisioned price — so no answer below may mention a pause to a workspace
 * that is not already in one. That would be inventing an offer, which is the one
 * thing this module refuses to do; the client renders the real offer from the
 * real response, beside these answers.
 *
 * `paused` is the other question, and it is a FACT the client has read rather
 * than an offer we are guessing at. It changes exactly two answers:
 *
 *   too_expensive  the CONTROL goes, the words stay. POST /v1/billing/change-plan
 *                  answers 409 while `companies.paused_at` is set, so "Switch to
 *                  Starter" is a button whose only outcome is a refusal — and a
 *                  refusal reached by pressing something we drew is worse than
 *                  no button, because we drew it. The cheaper plan is still the
 *                  true answer to "this costs too much", so the copy keeps it and
 *                  names the order the API's own refusal names: resume, then
 *                  switch.
 *   seasonal       the 30-day hold is not what is holding their number — the
 *                  pause is, and it has no deadline. The unpaused answer's whole
 *                  argument is that a long quiet season outruns the hold, which
 *                  is false for somebody who has already taken the option that
 *                  argument exists to compare against, and it contradicts the
 *                  paused card sitting on the same screen.
 *
 * The other four are unchanged, each for its own reason: missing_feature is a
 * support promise, which a paused plan does not change; too_expensive on Starter
 * still has no cheaper plan to name; and switched / not_using / other still have
 * nothing honest to add — a pause does not make us know what they switched to.
 *
 * A CANCELLED WORKSPACE IS NOT PAUSED, whatever its row still says, so the flag
 * is honoured in the BEFORE phase only. `paused_at` survives cancellation on
 * purpose — the daily reconcile skips cancelled tenants and
 * `claim_checkout_activation` clears it only if they come back (see
 * 20260805080000_resubscribe_clears_pause.sql) — so a stale `true` would reach
 * the grace answers and deny the 30-day clock that is, by then, genuinely
 * running. `isPaused` in scripts/ops/pricing-report.mjs draws this same line
 * after the same fact reached a founder report and named a churned workspace as
 * a paying paused one.
 *
 * # A figure may only be printed on the path that enforces it
 *
 * The rule this module settled on after the first round of copy shipped with a
 * limit the next click did not apply. The two routes back to Starter are not the
 * same route and do not enforce the same things:
 *
 *   before  POST /v1/billing/change-plan. Refuses (409) while the workspace
 *           holds more numbers than PLAN_LIMITS.starter.numbers, and again while
 *           active members exceed the Starter seats. So the seat and number
 *           allowances are real there, and are stated.
 *   grace   Stripe checkout. Its only gates are "one live subscription" and the
 *           US registration draft — no seat count, no number count — and
 *           `checkout.session.completed` then un-suspends EVERY suspended number
 *           with no plan filter. So a Pro workspace with two numbers and eight
 *           members can come back on Starter holding two and eight, and the
 *           seat/number allowances are NOT stated there.
 *
 * The alternative was to drop the grace action instead. It was rejected:
 * change-plan already 409s a canceled subscription ("resubscribe to change
 * plans"), so checkout is the ONLY way back once the subscription is dead, and
 * removing the control would leave the win-back with nothing to press at the one
 * moment it is worth anything. What was false was the FIGURE, not the button.
 * The under-enforcement itself is an API bug and belongs in the API; copy that
 * quietly documents a loophole is not the fix, and copy that promises a ceiling
 * nobody applies is the defect.
 *
 * # Why the strings live in packages/shared
 *
 * Kotlin and Swift hand-port this file. Three hand-typed copies of a sentence
 * carrying a price and a deadline is three chances to be wrong about money, and
 * the wrong one is always discovered by the customer. The figures are read from
 * the price book and the plan limits rather than typed, so a repricing moves
 * them everywhere at once.
 *
 * # Why no routes, icons or button styling come out of here
 *
 * `action` is an enum naming a control, not a link. The web has a
 * `ChangePlanDialog` and a `/settings/help` route; Android and iOS have a
 * HelpSection and their own navigation. A route string returned from here would
 * be wrong on two of the three platforms. The LABEL is shared, because the words
 * on the button are not platform-specific and three of them would drift.
 */

import {
  billingCurrencyOf,
  currencyForCountry,
  formatMoney,
  isBillingCurrency,
  PLAN_PRICE_CENTS,
  type BillingCurrency,
} from "./billing-currency";
import { PLAN_NUMBERS, PLAN_SEATS, type SeatPlan } from "./seats";
import {
  SUPPORT_FIX_PROMISE_KEY,
  SUPPORT_RESPONSE_TIME_KEY,
  type SayKey,
} from "./support";

/**
 * The reason codes the cancel card offers, on every client.
 *
 * The LABELS stay with each client's card (they are that screen's copy); the
 * codes are the contract, because they are what is stored and reported on.
 * Every one stays inside the 40 characters `cancellation_reasons.reason`
 * accepts.
 */
export const CANCELLATION_REASON_CODES = [
  "too_expensive",
  "seasonal",
  "missing_feature",
  "switched",
  "not_using",
  "other",
] as const;

export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

export function isCancellationReasonCode(
  value: unknown,
): value is CancellationReasonCode {
  return (
    typeof value === "string" &&
    (CANCELLATION_REASON_CODES as readonly string[]).includes(value)
  );
}

/**
 * SPEC §1 key rule 2 / §9: the number is held this long after cancellation.
 *
 * THE CLOCK RUNS FROM `companies.canceled_at`, not from the period end, because
 * that is what the job does — `runGraceJob` measures `now - canceled_at` and
 * releases at 30. Copy that says "30 days after your last period" describes a
 * different date from the one the number actually dies on, and a deadline that
 * is wrong in the customer's favour is the expensive direction to be wrong in.
 *
 * `apps/api/src/billing/grace.ts` derives its `GRACE_PERIOD_DAYS` from this, so
 * there is one number rather than a copy the clients could drift from.
 */
export const CANCELLATION_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When this workspace's number goes back to the carrier, or null if it is not
 * cancelled.
 *
 * A Date rather than a formatted string: each client formats with its own
 * platform formatter (`toLocaleDateString`, `DateTimeFormatter`,
 * `Date.FormatStyle`), and a string built here would be in one locale for all
 * three. Mirrors `releaseDateLabel` in grace.ts, which is what prints the same
 * date in the day-27 email.
 */
export function numberReleaseAt(
  canceledAt: string | null | undefined,
): Date | null {
  if (typeof canceledAt !== "string" || canceledAt.trim() === "") return null;
  const canceled = new Date(canceledAt);
  if (Number.isNaN(canceled.getTime())) return null;
  return new Date(canceled.getTime() + CANCELLATION_GRACE_DAYS * DAY_MS);
}

/**
 * Is this workspace still inside the window where coming back keeps the number?
 *
 * The grace offer must not be rendered outside it. Past the release the number
 * is gone — back in carrier inventory and reassignable to another business
 * (#413) — so "resubscribe and keep your number" becomes false at exactly this
 * boundary, and it is the sort of false that gets discovered by the person it
 * was promised to.
 */
export function isWithinCancellationGrace(
  canceledAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const release = numberReleaseAt(canceledAt);
  return release !== null && now.getTime() < release.getTime();
}

/**
 * Where the offer is being read.
 *
 * The same reason gets the same ANSWER in both places and a different verb: on
 * the cancel card the subscription is still live, so the control is the plan
 * switch; during grace it is over, so the control is coming back. Two phases in
 * one function rather than two functions, because the facts are identical and
 * splitting them is how one of the two ends up stale.
 */
export type CancellationOfferPhase = "before" | "grace";

/**
 * A control the client already has. Never a route: see the header.
 *
 *   change_plan         the plan switcher on the billing screen (web's
 *                       ChangePlanDialog), targeting Starter.
 *   resubscribe_starter the resubscribe control on the canceled-state card,
 *                       with Starter as the plan rather than the old one. It
 *                       opens CHECKOUT, which applies no seat or number limit —
 *                       so the copy alongside it may name the price and nothing
 *                       else. See "A figure may only be printed on the path that
 *                       enforces it" in the header.
 *   open_help           the in-product help surface (#382): web's
 *                       /settings/help, the HelpSection on both phones.
 */
export type CancellationOfferAction =
  | "change_plan"
  | "resubscribe_starter"
  | "open_help";

export interface CancellationOffer {
  /** The reason this answers, so a client can key a snapshot on it. */
  reason: CancellationReasonCode;
  heading: string;
  body: string;
  /** Null when the words are the whole answer and there is nothing to press. */
  action: CancellationOfferAction | null;
  /** The words on that control, or null when there is no control. */
  actionLabel: string | null;
}

export interface CancellationOfferInput {
  /** The stored reason code. Anything unrecognised yields null. */
  reason: string | null | undefined;
  /** `companies.plan`. Null (never checked out) is treated as Starter. */
  plan: string | null | undefined;
  /** Default "before" — the cancel card. */
  phase?: CancellationOfferPhase;
  /**
   * `companies.billing_currency`. What the card is actually charged, and so
   * what any price we print must be in.
   */
  billingCurrency?: string | null;
  /**
   * `companies.country`. Used ONLY to pick a currency when the workspace has no
   * stored one, which is what every workspace predating #328 looks like.
   */
  country?: string | null;
  /**
   * `companies.registration_fee_paid_at`. Non-null unlocks one extra sentence in
   * the seasonal answer, and it is the sentence that answers the question a
   * seasonal business is actually asking: what does coming back cost.
   */
  registrationFeePaidAt?: string | null;
  /**
   * #277 — is this workspace's plan paused RIGHT NOW? `companies.paused_at !==
   * null`, as `GET /v1/billing/pause` reports it.
   *
   * OMITTED MEANS NOT PAUSED, and that is deliberate rather than lazy: every
   * answer this module gave before the pause existed is the answer for an
   * unpaused workspace, so a caller that does not pass this reads exactly what
   * it read before, byte for byte. Three clients hand-port these strings and
   * their tests compare them.
   *
   * PASS THE FACT YOU HAVE READ, not the absence of one. A client whose pause
   * read has not landed or has failed knows nothing, and `false` is not nothing
   * — it is a claim, and on a paused workspace it is the claim that puts a
   * "Switch to Starter" button in front of a 409. Each client models that
   * unread state on its own billing screen (it decides a badge and a plan
   * switcher there too); the rule those clients follow is to withhold the
   * control until the read answers, and this module cannot enforce it from
   * here — a single boolean cannot tell "no" apart from "not yet".
   */
  paused?: boolean | null;
}

/**
 * What this workspace is charged in.
 *
 * The stored currency wins whenever it is one we bill in. `billingCurrencyOf`
 * alone would answer USD for a Canadian workspace with a null column, which is
 * the one case the country actually knows better about.
 */
function resolveCurrency(input: CancellationOfferInput): BillingCurrency {
  if (isBillingCurrency(input.billingCurrency)) {
    return billingCurrencyOf(input.billingCurrency);
  }
  return currencyForCountry(input.country);
}

/** `companies.plan`, narrowed. Null means no checkout has happened yet. */
function resolvePlan(plan: string | null | undefined): SeatPlan {
  return plan === "pro" ? "pro" : "starter";
}

/**
 * The cheaper-plan answer, and the ONE case it is not offered.
 *
 * A workspace already on Starter gets nothing, because there is nothing below
 * it. The alternative — some softer sentence about how the price is fair — is an
 * argument with somebody who has just told us it is not, on the screen they came
 * to leave from.
 *
 * The facts:
 *   price     PLAN_PRICE_CENTS, the book both routes charge from. Said in both
 *             phases.
 *   seats     PLAN_SEATS, which POST /v1/billing/change-plan refuses a
 *             downgrade over. Said in the BEFORE phase only.
 *   numbers   PLAN_NUMBERS, likewise. Before phase only.
 *   timing    a downgrade applies at period end via a subscription schedule,
 *             so nothing stops today.
 *
 * The smaller allowances are named without a figure, matching the plan card on
 * this same screen: #85 and #121 put the concrete numbers only in the fair-use
 * policy, and a count quoted here would be a second home for them.
 *
 * WHY THE BEFORE PHASE NAMES A REFUSAL. It used to end "your number and your
 * message history stay exactly as they are", which is true for the workspace
 * that fits Starter and false for exactly the workspace being spoken to: a Pro
 * tenant holding a second number is REFUSED the downgrade until it is released,
 * so the second number is the one thing that does not stay as it is. The history
 * genuinely does survive, and is still promised; the number is not, because the
 * next click is where they would find out.
 *
 * The clause is conditional rather than counted on purpose. Answering it exactly
 * would need the live number and member counts threaded through three clients,
 * and a conditional is already true for everybody: the tenant who fits reads
 * past it, and the tenant who does not is warned before the 409 rather than by
 * it.
 *
 * WHY THE PAUSED ANSWER HAS NOTHING TO PRESS. `change_plan` names the plan
 * switcher, and POST /v1/billing/change-plan refuses outright while
 * `companies.paused_at` is set — a plan change during a pause is ambiguous in a
 * way only the customer can settle (resume onto the new plan now, or land on it
 * in spring?), so the API asks for the two steps in order rather than guessing.
 * The plan card's own switcher is gated on the same fact, so a button here would
 * be the ONLY pressable route to that 409 on the whole screen, drawn by us, an
 * inch under an answer somebody volunteered.
 *
 * There is no `resume` action either, and that is not an oversight: Resume
 * already sits on the paused card at the top of this same screen, and a second
 * one down here would be a retention funnel growing a control — see the header.
 * The words name the order instead, in the API's own words, so somebody who goes
 * and does it reads the same sentence twice rather than a contradiction.
 */
function tooExpensiveOffer(
  input: CancellationOfferInput,
  phase: CancellationOfferPhase,
  paused: boolean,
  say: SayKey,
): CancellationOffer | null {
  if (resolvePlan(input.plan) !== "pro") return null;

  const currency = resolveCurrency(input);
  const starter = formatMoney(PLAN_PRICE_CENTS[currency].starter, currency);
  const pro = formatMoney(PLAN_PRICE_CENTS[currency].pro, currency);
  const numbers = PLAN_NUMBERS.starter;

  /**
   * True on both routes back, because both end at a Starter subscription built
   * from the Starter prices — the schedule phase a downgrade writes, and the
   * session a resubscribe checks out through. The metered allowances ride those
   * same prices, so the fair-use sentence travels with the figure.
   */
  const price = say("settings.offerStarterPrice")
    .replace("{starter}", starter)
    .replace("{pro}", pro);

  /**
   * Seats and numbers, and so only for the phase whose route refuses them.
   *
   * The singular is ITS OWN KEY rather than an appended "s". French pluralises
   * the noun and its article together, so a suffix cannot express it, and this
   * is the kind of sentence that reads fine in English right up until it is
   * translated.
   */
  const limits = say(
    numbers === 1 ? "settings.offerStarterCoversOne" : "settings.offerStarterCovers",
  )
    .replace("{seats}", String(PLAN_SEATS.starter))
    .replace("{numbers}", String(numbers));

  /**
   * Same heading as the unpaused answer, on purpose. It is a fact about the two
   * plans and the pause does not touch it; a second heading would be a second
   * string for three clients to hand-port and drift.
   */
  const seats = String(PLAN_SEATS.starter);

  if (paused) {
    return {
      reason: "too_expensive",
      heading: say("settings.offerStarterHeading"),
      body: `${price} ${limits} ${say("settings.offerStarterTailPaused").replace("{seats}", seats)}`,
      action: null,
      actionLabel: null,
    };
  }

  return phase === "grace"
    ? {
        reason: "too_expensive",
        heading: say("settings.offerStarterHeadingGrace"),
        body: `${price} ${say("settings.offerStarterTailGrace")}`,
        action: "resubscribe_starter",
        actionLabel: say("settings.offerComeBackOnStarter"),
      }
    : {
        reason: "too_expensive",
        heading: say("settings.offerStarterHeading"),
        body: `${price} ${limits} ${say("settings.offerStarterTail").replace("{seats}", seats)}`,
        action: "change_plan",
        actionLabel: say("settings.planSwitchToStarter"),
      };
}

/**
 * The fee sentence, only for a workspace that has actually paid it.
 *
 * Gated on the timestamp rather than on country, because the timestamp is the
 * exact thing checkout tests: the $29 line is added only when
 * `registration_fee_paid_at IS NULL`, and the webhook stamps it once per company
 * ever. A workspace that has not paid it WILL be charged on return, so for them
 * this sentence is simply absent rather than softened.
 *
 * SAID TO THE PAUSED READER TOO. It answers "what does coming back cost", and
 * that question survives the pause unchanged: the fee is charged at most once per
 * workspace ever, so neither resuming nor cancelling-and-returning charges it
 * again. Lifted out of `seasonalOffer` when the paused answer needed the same
 * sentence — one copy, because two would be one promise about money typed twice.
 */
function registrationFeeSentence(input: CancellationOfferInput, say: SayKey): string {
  return typeof input.registrationFeePaidAt === "string" &&
    input.registrationFeePaidAt.trim() !== ""
    ? say("settings.offerRegistrationFeePaid")
    : "";
}

/**
 * The seasonal answer for somebody who ALREADY PAUSED, and is cancelling anyway.
 *
 * They are not choosing between leaving and a 30-day hold; they are choosing
 * between the thing they already have and giving it up, and only one of those
 * two has a deadline. So this answer states both sides of exactly that:
 *
 *   what they have   the number and the history are held, and nothing expires
 *                    while the plan is paused. The pause is a licensed-price
 *                    swap with no clock attached — `runGraceJob` measures
 *                    `now - canceled_at` and a paused workspace has no
 *                    `canceled_at`, so there is genuinely nothing counting.
 *   what they lose   cancelling ends the pause and starts the hold, and the hold
 *                    is the only countdown in this product. Anchored to the
 *                    cancellation for the reason `seasonalOffer` gives at length.
 *
 * NO CONTROL, same as every other seasonal answer. Resume is already on the
 * paused card on this screen, and the point of the paragraph is not to press
 * anything — it is that somebody about to trade an open-ended hold for a 30-day
 * one should know that is the trade.
 *
 * IT IS NOT AN ARGUMENT. Two facts, in the order they matter, and no sentence
 * telling them which to pick. The cancel card records an answer and does not
 * argue with the decision; what makes this worth printing is that the fact is not
 * available anywhere else on the screen, not that we would rather they stayed.
 *
 * IT SAYS "PAUSED" OUT LOUD, which every other string in this file may not. Safe
 * here and only here: they are in a pause, so it is a description of their
 * account rather than an offer we cannot see the eligibility of.
 */
function pausedSeasonalOffer(
  input: CancellationOfferInput,
  say: SayKey,
): CancellationOffer {
  return {
    reason: "seasonal",
    heading: say("settings.offerPausedSeasonalHeading"),
    body:
      say("settings.offerPausedSeasonalBody").replace(
        "{days}",
        String(CANCELLATION_GRACE_DAYS),
      ) + registrationFeeSentence(input, say),
    action: null,
    actionLabel: null,
  };
}

/**
 * The seasonal answer: what is already true about going quiet and coming back.
 *
 * THIS COPY IS FOR SOMEBODY WHO HAS NOT PAUSED. What it describes is the 30-day
 * hold, and for a business that goes quiet for a winter the useful facts are
 * that the number keeps receiving, the history survives, and the one-time
 * registration fee is not charged twice. It must not mention the pause: whether
 * one is on offer is the API's read, not ours (see the header).
 *
 * THE PAUSED READER GETS A DIFFERENT ANSWER, because every load-bearing clause
 * below is either wrong or beside the point for them. Their number is not being
 * held by the 30-day hold, it is being held by the pause; they CAN already plan a
 * quiet season longer than 30 days, so the sentence about a season outrunning the
 * hold — the whole reason this answer is worth showing — is false for them; and
 * the paused card on the same screen says in as many words that nothing expires
 * while they are paused, so the two sentences would be on screen together,
 * disagreeing. What they are actually deciding is pause-versus-cancel, so that is
 * what {@link pausedSeasonalOffer} answers.
 *
 * "You will not be able to reply" is in there on purpose. `runPreSendGates`
 * requires an active subscription and answers 402 otherwise, so a cancelled
 * workspace can receive and cannot send. Leaving that out would let somebody
 * plan a quiet season around a product that answers their customers, and find
 * out otherwise from a customer.
 *
 * THE HEADING MAY NOT COVER THE SEASON. It used to read "Your number is held
 * while you are gone", over a body that said 30 days, to a reader who had just
 * said they would be back next spring. A trades quiet season is months; the hold
 * is 30 days; and the heading is the line that gets read. So the heading carries
 * the duration and the anchor, and the body says plainly that a longer season
 * outruns it — which is the whole reason this answer is worth showing to
 * somebody whose plan is to disappear until the work comes back.
 *
 * THE ANCHOR IS THE CANCELLATION, NOT THE PERIOD END. `runGraceJob` measures
 * `now - canceled_at`, and `startCancellationLifecycle` stamps that column from
 * Stripe's `canceled_at`, which for a `cancel_at_period_end` cancellation is the
 * time of the REQUEST (vendored `Subscriptions.d.ts` says so in as many words),
 * not the end of the period. Somebody who cancels on day 2 of a month and reads
 * "your period ends, then we hold it for 30 days" counts about 59 days and has
 * about 30. What they lose at the end of the miscount is the number on the side
 * of the van.
 */
function seasonalOffer(
  input: CancellationOfferInput,
  phase: CancellationOfferPhase,
  say: SayKey,
): CancellationOffer {
  const fee = registrationFeeSentence(input, say);
  const days = String(CANCELLATION_GRACE_DAYS);

  return phase === "grace"
    ? {
        reason: "seasonal",
        heading: say("settings.offerSeasonalGraceHeading"),
        body: say("settings.offerSeasonalGraceBody").replace("{days}", days) + fee,
        action: null,
        actionLabel: null,
      }
    : {
        reason: "seasonal",
        heading: say("settings.offerSeasonalHeading").replace("{days}", days),
        body: say("settings.offerSeasonalBody").replace("{days}", days) + fee,
        action: null,
        actionLabel: null,
      };
}

/**
 * The missing-feature answer: the route to a human, and what it promises.
 *
 * Both sentences are read from `support.ts` rather than restated, for the reason
 * that module gives: a response time typed into three clients separately is a
 * promise somebody made without knowing they were making it. Same words the help
 * screen shows, so the offer cannot promise something the help screen does not.
 */
function missingFeatureOffer(say: SayKey): CancellationOffer {
  return {
    reason: "missing_feature",
    heading: say("settings.offerMissingHeading"),
    body: say("settings.offerMissingBody")
      .replace("{when}", say(SUPPORT_RESPONSE_TIME_KEY))
      .replace("{promise}", say(SUPPORT_FIX_PROMISE_KEY)),
    action: "open_help",
    actionLabel: say("settings.offerGetHelp"),
  };
}

/**
 * The answer to a stated reason, or null for "say nothing".
 *
 * NULL IS THE COMMON CASE and it is a real answer. Three of the six reasons
 * return it always, one returns it on Starter, and an unrecognised or absent
 * reason returns it too — a client that sends a code from a newer build must
 * render nothing rather than guess.
 */
export function cancellationOffer(
  input: CancellationOfferInput,
  /**
   * #228 — resolves a catalogue key in the reader's language.
   *
   * This module names its sentences and does not own a catalogue, so the caller
   * supplies the lookup. The keys are iOS's, which converted first; the web and
   * Android read the same ones, so a wording change lands on three clients.
   */
  say: SayKey,
): CancellationOffer | null {
  if (!isCancellationReasonCode(input.reason)) return null;
  const phase = input.phase ?? "before";
  /**
   * The pause fact, narrowed to the phase it can be true in.
   *
   * `paused_at` outlives the subscription it belonged to — see the header — so a
   * grace-phase caller reading a company row can hand us a `true` for a
   * workspace whose pause died with its subscription and whose 30-day clock is
   * running right now. Honouring it there would answer "nothing expires" to the
   * one reader for whom something is expiring, on a date we print two lines
   * further down. `=== true` rather than truthiness because the field is
   * `boolean | null` and a client that has nothing to say says null.
   */
  const paused = input.paused === true && phase === "before";

  switch (input.reason) {
    case "too_expensive":
      return tooExpensiveOffer(input, phase, paused, say);
    case "seasonal":
      return paused ? pausedSeasonalOffer(input, say) : seasonalOffer(input, phase, say);
    // The support promise does not change because the plan is paused, for the
    // same reason it does not change between the two phases: it is a promise
    // about us, not about their subscription.
    case "missing_feature":
      return missingFeatureOffer(say);
    // switched / not_using / other: nothing honest to add, paused or not — a
    // pause does not tell us what they switched to. See the header.
    default:
      return null;
  }
}
