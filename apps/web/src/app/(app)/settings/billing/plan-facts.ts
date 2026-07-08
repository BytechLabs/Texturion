import { PLAN_PRICING } from "@/lib/api/types";
import type { PlanId } from "@/lib/api/types";

/** The human plan facts shown on the billing plan card. */
export interface PlanFacts {
  name: string;
  price: string;
  included: string;
  seats: string;
  numbers: string;
  overage: string;
}

/**
 * SPEC §2 plan facts shown on the plan card, DERIVED from PLAN_PRICING (the
 * shared mirror of apps/api/src/billing/plans.ts) so a retune of a price, seat,
 * number, text, or overage figure can never leave this paying-customer surface
 * quoting a stale number. Only the human plan name is a literal — there is no
 * name constant to source.
 */
function planFacts(id: PlanId, name: string): PlanFacts {
  const p = PLAN_PRICING[id];
  return {
    name,
    price: `$${p.monthlyDollars}/mo`,
    included: `${p.includedTexts.toLocaleString("en-US")} outgoing texts included each month`,
    seats: `${p.seats} team members`,
    numbers: `${p.numbers} phone number${p.numbers === 1 ? "" : "s"}`,
    overage: `${p.overageCentsPerText}¢ per extra text after that`,
  };
}

export const PLAN_FACTS: Record<PlanId, PlanFacts> = {
  starter: planFacts("starter", "Starter"),
  pro: planFacts("pro", "Pro"),
};
