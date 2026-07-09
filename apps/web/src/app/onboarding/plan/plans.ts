import { PLAN_PRICING } from "@/lib/api/types";
import type { PlanId } from "@/lib/api/types";

export interface PlanCard {
  id: PlanId;
  name: string;
  price: string;
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
    lines: [
      `${p.includedTexts.toLocaleString("en-US")} outgoing texts included each month`,
      crewLine,
      `${p.numbers} business number${p.numbers === 1 ? "" : "s"}`,
      "Incoming texts & photos free, always",
      `${p.overageCentsPerText}¢ per extra outgoing text`,
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
