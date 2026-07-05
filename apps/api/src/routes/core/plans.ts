/**
 * Plan limits for the route layer (SPEC §2 pricing table). The numbers live
 * in ONE place — src/billing/plans.ts, the billing track's canonical §2
 * module — and are re-exported/derived here so route code keeps its short
 * import path without duplicating the values.
 */
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_LIMITS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  type PlanId,
} from "../../billing/plans";

export {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  type PlanId,
};

/** Seats per plan (SPEC §2), derived from the canonical limits table. */
export const PLAN_SEATS: Record<PlanId, number> = {
  starter: PLAN_LIMITS.starter.seats,
  pro: PLAN_LIMITS.pro.seats,
};

/**
 * Seat allowance for a company. A company that has never checked out has
 * plan NULL (SPEC §6) — it gets the Starter allowance until a plan exists,
 * so a team can be assembled before payment without exceeding what the
 * smallest plan would permit.
 */
export function seatLimit(plan: string | null): number {
  return plan === "pro" ? PLAN_SEATS.pro : PLAN_SEATS.starter;
}
