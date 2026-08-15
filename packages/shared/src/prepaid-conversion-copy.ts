/**
 * #583 / D131 — the two sentences that make a promise about a prepaid year.
 *
 * A plan change inside a prepaid window ends the year and credits the unconsumed
 * value back. Three clients ask for that consent, and what they say is not
 * decoration: it is the promise. So it is composed once here, hand-ported, and held
 * to this file by generated parity vectors.
 *
 * # The promise, and the one it must never make
 *
 * It says **credit and an amount**. It must never say months of free service.
 *
 * Stripe applies a customer credit balance to the WHOLE invoice — overage, modules,
 * extra numbers, all of it — so a heavy month can spend the credit and leave the plan
 * fee on the card anyway. "Two months of Pro free" would be a promise the mechanism
 * cannot keep, and it is exactly the promise D107 rejected customer credit for making
 * at the other end of this feature. D131 settles the design in money rather than
 * months; that decision is only honest if the words follow it on every client, which
 * is why the words are here rather than typed out three times.
 *
 * # Why the amount arrives pre-formatted
 *
 * Money formatting is already ported and vector-tested per client (`formatMoney`),
 * and it has to be, because the same amount reads differently to a Canadian and an
 * American. Re-deriving it here would be a second money formatter to keep in step.
 * So the caller formats and this composes — which also makes the null case
 * meaningful: no amount known, so no amount promised.
 */

/**
 * The two plans, declared locally.
 *
 * Every other module in this package does the same (`SeatPlan`,
 * `ExtraNumberPlan`) rather than sharing one union, and the reason holds here: a
 * package-wide `PlanId` would have to be imported by callers who only care about
 * two strings, and a widened one would silently admit a plan this copy has no
 * label for.
 */
export type PrepaidPlan = "starter" | "pro";

/** A plan's name as a customer reads it. */
function planLabel(plan: PrepaidPlan): string {
  return plan === "pro" ? "Pro" : "Starter";
}

export interface PrepaidConversionCopy {
  /** "You have a prepaid Starter year running." */
  heading: string;
  /** What switching does, including the amount when there is one. */
  explanation: string;
  /** The words beside the tick. Carries the figure it is agreeing to. */
  acknowledgement: string;
}

/**
 * @param credit The amount coming back, already formatted for this reader
 *   (`formatMoney`), or null when the server did not send a figure — an older row
 *   with no conversion recorded. Null means the sentences state that the year ends
 *   and promise no number, which is the only honest thing to say without one.
 */
/** Every catalogue key this module names. */
export type PrepaidConversionKey =
  | "settings.prepaidHeading"
  | "settings.prepaidEndsPlain"
  | "settings.prepaidEndsCredited"
  | "settings.prepaidAckPlain"
  | "settings.prepaidAckCredited";

/** The reader's resolver. */
export type SayPrepaidConversion = (key: PrepaidConversionKey) => string;

export function prepaidConversionCopy(
  fromPlan: PrepaidPlan,
  toPlan: PrepaidPlan,
  credit: string | null,
  say: SayPrepaidConversion,
): PrepaidConversionCopy {
  /*
   * #228 — the PLAN NAME is not translated and the sentence around it is.
   *
   * "Pro" and "Starter" are what the plans are called on the pricing page, in
   * Stripe and in a customer's invoice; a French reader picks "Pro" too. So
   * `planLabel` stays as it is and rides in as {plan}, while every sentence
   * holding it became a key. Both phones have had these five since their own
   * pass.
   */
  const heading = say("settings.prepaidHeading").replace(
    "{plan}",
    planLabel(fromPlan),
  );
  const target = planLabel(toPlan);
  if (credit === null) {
    return {
      heading,
      explanation: say("settings.prepaidEndsPlain").replace("{plan}", target),
      acknowledgement: say("settings.prepaidAckPlain"),
    };
  }
  return {
    heading,
    explanation: say("settings.prepaidEndsCredited")
      .replace("{credit}", credit)
      .replace("{plan}", target),
    acknowledgement: say("settings.prepaidAckCredited").replace("{credit}", credit),
  };
}
