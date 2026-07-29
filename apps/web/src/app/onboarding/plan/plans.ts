import { PLAN_PRICING } from "@/lib/api/types";
import type { PlanId } from "@/lib/api/types";

export interface PlanCard {
  id: PlanId;
  name: string;
  price: string;
  /**
   * #381 — the monthly figure said again in a unit people spend in.
   *
   * A tradesperson reads "$29/month" against every other subscription they
   * already resent paying for. The same number as a daily amount is the
   * comparison that actually matches how the cost lands — one job answered
   * pays for the year. DERIVED, so a retune can never leave it lying.
   *
   * *Applying: Contrast & Anchoring — present a cost alongside the smaller
   * relatable amount, not only the number the card charges.*
   */
  daily: string;
  lines: string[];
}

// SPEC §2 plan table, in human terms (G7: feature deltas in 5 lines max).
// Every figure is DERIVED from PLAN_PRICING (the shared mirror of
// apps/api/src/billing/plans.ts) so a retune can never leave this card lying;
// only the plan name and the fixed prose (which crew line, the always-free
// line) are literals. `crewLine` differs per plan on purpose (G7 copy), but
// its seat count still traces to the constant.
function planCard(id: PlanId, name: string, crewLine: string): PlanCard {
  const p = PLAN_PRICING[id];
  return {
    id,
    name,
    price: `$${p.monthlyDollars}`,
    // 30 days, not 30.44: a round month is what somebody checks on their
    // fingers, and being a cent optimistic about our own price is the wrong
    // direction to be imprecise in.
    daily: `about $${(p.monthlyDollars / 30).toFixed(2)} a day`,
    lines: [
      "Texting included, bound by fair use",
      crewLine,
      `${p.numbers} business number${p.numbers === 1 ? "" : "s"}`,
      "Incoming texts & photos free, always",
      // #121: no per-text price in sales copy; the rate lives in the
      // fair-use policy the plan step links to.
      "Busy month? Extra texts bill under fair use, capped by you",
    ],
  };
}

export const PLANS: PlanCard[] = [
  planCard(
    "starter",
    "Starter",
    `Your whole crew, ${PLAN_PRICING.starter.seats} teammates`,
  ),
  planCard("pro", "Pro", `${PLAN_PRICING.pro.seats} teammates`),
];
