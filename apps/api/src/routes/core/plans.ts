/**
 * Plan limits for the route layer (SPEC §2 pricing table). The numbers live
 * in ONE place — src/billing/plans.ts, the billing track's canonical §2
 * module — and are re-exported/derived here so route code keeps its short
 * import path without duplicating the values.
 */
import {
  PLAN_NUMBERS as SHARED_PLAN_NUMBERS,
  PLAN_SEATS as SHARED_PLAN_SEATS,
} from "@loonext/shared";

import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_LIMITS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
  type PlanId,
} from "../../billing/plans";

export {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
  type PlanId,
};

/** Seats per plan (SPEC §2), derived from the canonical limits table. Both
 *  self-serve plans are capped (#83: Starter 3, Pro 15); unlimited is the
 *  contact-sales Enterprise tier, which is not a billable plan_id. */
export const PLAN_SEATS: Record<PlanId, number> = {
  starter: PLAN_LIMITS.starter.seats,
  pro: PLAN_LIMITS.pro.seats,
};

// #392: the shared module is the one place this rule lives now. Asserting the
// two agree at module load rather than exporting the shared copy directly
// keeps PLAN_LIMITS (which also carries `numbers`) as the billing source of
// truth, while making a divergence impossible to ship quietly.
if (
  PLAN_SEATS.starter !== SHARED_PLAN_SEATS.starter ||
  PLAN_SEATS.pro !== SHARED_PLAN_SEATS.pro
) {
  throw new Error(
    "PLAN_LIMITS seats and @loonext/shared PLAN_SEATS disagree — a seat change landed in one of them only.",
  );
}

// The same guard for the number allowance, which the cancel screen's
// cheaper-plan answer now NAMES to a customer. A drift here would put a figure
// in front of somebody that POST /v1/billing/change-plan then refuses them on.
if (
  PLAN_LIMITS.starter.numbers !== SHARED_PLAN_NUMBERS.starter ||
  PLAN_LIMITS.pro.numbers !== SHARED_PLAN_NUMBERS.pro
) {
  throw new Error(
    "PLAN_LIMITS numbers and @loonext/shared PLAN_NUMBERS disagree — a plan change landed in one of them only.",
  );
}

/**
 * Seat allowance for a company. A company that has never checked out has plan
 * NULL (SPEC §6) — it gets the Starter allowance until a plan exists, so a team
 * can be assembled before payment without exceeding what the smallest plan
 * would permit.
 */
export function seatLimit(plan: string | null): number {
  return plan === "pro" ? PLAN_SEATS.pro : PLAN_SEATS.starter;
}
