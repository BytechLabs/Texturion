import {
  isBeyondSupportedCrew,
  planFitForCrew,
  type CrewSizeBucket,
} from "@loonext/shared";

import { PLAN_PRICING } from "@/lib/api/types";

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
export function crewFitCopy(bucket: CrewSizeBucket): string {
  if (isBeyondSupportedCrew(bucket)) {
    return `Our biggest plan covers ${PLAN_PRICING.pro.seats} people. Past that, tell us how your crew works and we'll be straight with you about the fit.`;
  }
  const plan = planFitForCrew(bucket);
  // Unreachable while 11+ is the only null bucket; a future one would fall
  // through to the neutral hint rather than to an empty description.
  if (plan === null) return "";
  const { seats, monthlyDollars } = PLAN_PRICING[plan];
  const name = plan === "pro" ? "Pro" : "Starter";
  return `${name} covers up to ${seats} people at $${monthlyDollars} a month, however many customers you text.`;
}

/** Shown before anything is picked. Says the question is skippable. */
export const CREW_FIT_PROMPT =
  "Everyone answers on the same number, so this only decides which plan fits. Skip it if you'd rather.";
