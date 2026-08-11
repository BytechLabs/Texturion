import {
  DEFAULT_LOCALE,
  isBeyondSupportedCrew,
  planFitForCrew,
  type CrewSizeBucket,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { PLAN_PRICING } from "@/lib/api/types";

/** English, for a caller with no provider around it — the unit tests. */
const EN = makeTranslate(DEFAULT_LOCALE);

/**
 * #370 — what picking a crew size says back.
 *
 * The wizard answers nothing else the customer enters, and this is the one
 * question whose answer we can respond to immediately and usefully: every
 * competitor bills per seat and we do not, so knowing the crew size is knowing
 * which plan fits.
 *
 * # Both numbers are derived
 *
 * Prices and seat counts come from PLAN_PRICING, never typed here. This is a
 * paying-customer surface, and a hand-written "$29" is a claim that silently
 * stops being true the day pricing moves.
 *
 * # The 11+ branch recommends nothing, deliberately
 *
 * That is the whole reason `planFitForCrew` returns null for it. Pro's seat
 * limit is 15 and #244's on-call routing does not exist, so ring-all across a
 * large crew is a worse experience rather than a better one. Recommending Pro
 * would sell somebody a plan they could outgrow during onboarding, and #370 is
 * explicit that we should not market to a segment we serve worse. Stating the
 * ceiling and inviting the conversation is the honest version.
 */
export function crewFitCopy(
  bucket: CrewSizeBucket,
  t: Translate = EN,
): string {
  if (isBeyondSupportedCrew(bucket)) {
    return t("onboarding.crewFitBeyond", { seats: PLAN_PRICING.pro.seats });
  }
  const plan = planFitForCrew(bucket);
  // Unreachable while 11+ is the only null bucket; a future one would fall
  // through to the neutral hint rather than to an empty description.
  if (plan === null) return "";
  const { seats, monthlyDollars } = PLAN_PRICING[plan];
  // A product name, the same in every language.
  const name = plan === "pro" ? "Pro" : "Starter";
  return t("onboarding.crewFitPlan", {
    plan: name,
    seats,
    amount: `$${monthlyDollars}`,
  });
}

/** Shown before anything is picked. Says the question is skippable. */
export function crewFitPrompt(t: Translate = EN): string {
  return t("onboarding.crewFitPrompt");
}
