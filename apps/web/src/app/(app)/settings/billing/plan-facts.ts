import {
  billingCurrencyOf,
  formatMoney,
  PLAN_PRICE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

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
function planFacts(
  id: PlanId,
  name: string,
  currency: BillingCurrency,
): PlanFacts {
  const p = PLAN_PRICING[id];
  return {
    name,
    // #328: the currency this workspace is actually charged in, not a
    // hardcoded dollar sign. A Canadian owner reading "$29/mo" beside a
    // Canadian invoice for $39 has caught us in a contradiction, on the one
    // screen where the number IS the content.
    //
    // Unprefixed: it is their own money, and "CA$39" to a Canadian reads as
    // though we expect them to be confused about it.
    price: `${formatMoney(PLAN_PRICE_CENTS[currency][id], currency)}/mo`,
    // #85: the plan card no longer leads with a hard message-count ceiling. The
    // allowance is a fair-use line (the exact figure lives in the fair-use
    // policy the billing page links to), and the usage screen shows real usage.
    included: "Texting for your crew, bound by fair use",
    seats: `${p.seats} team members`,
    numbers: `${p.numbers} phone number${p.numbers === 1 ? "" : "s"}`,
    // #121: the concrete rate lives in the fair-use policy the card links to.
    overage: "Extra texts bill under fair use, up to a cap you control",
  };
}

/**
 * The plan facts, in the currency a workspace is billed in.
 *
 * A function rather than a constant because the currency is a property of the
 * workspace reading the screen, and there is no such thing as "the" price any
 * more. Callers have the company loaded — that is where the currency comes
 * from, and passing anything unrecognised falls back to USD, which is what
 * every existing workspace is on.
 */
export function planFactsFor(
  currency: unknown,
): Record<PlanId, PlanFacts> {
  const c = billingCurrencyOf(currency);
  return {
    starter: planFacts("starter", "Starter", c),
    pro: planFacts("pro", "Pro", c),
  };
}

/** The USD facts, for surfaces that have no company in hand. */
export const PLAN_FACTS: Record<PlanId, PlanFacts> = planFactsFor("usd");
