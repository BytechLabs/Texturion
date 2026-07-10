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
 * SPEC §2 plan facts shown on the plan card. The price, seat, number, and
 * overage figures are DERIVED from PLAN_PRICING (the shared mirror of
 * apps/api/src/billing/plans.ts) so a retune can never leave this paying-
 * customer surface quoting a stale number. The `included` line is deliberately
 * NOT the hard message count (#85): it is a fair-use line, with the exact figure
 * in the fair-use policy the billing page links to. Only the human plan name is
 * a literal — there is no name constant to source.
 */
function planFacts(id: PlanId, name: string): PlanFacts {
  const p = PLAN_PRICING[id];
  return {
    name,
    price: `$${p.monthlyDollars}/mo`,
    // #85: the plan card no longer leads with a hard message-count ceiling. The
    // allowance is a fair-use line (the exact figure lives in the fair-use
    // policy the billing page links to), and the usage screen shows real usage.
    included: "Texting for your crew, bound by fair use",
    seats: `${p.seats} team members`,
    numbers: `${p.numbers} phone number${p.numbers === 1 ? "" : "s"}`,
    overage: `${p.overageCentsPerText}¢ per extra outgoing text`,
  };
}

export const PLAN_FACTS: Record<PlanId, PlanFacts> = {
  starter: planFacts("starter", "Starter"),
  pro: planFacts("pro", "Pro"),
};
