import {
  billingCurrencyOf,
  DEFAULT_LOCALE,
  formatMoney,
  PLAN_PRICE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

import { PLAN_PRICING } from "@/lib/api/types";
import type { PlanId } from "@/lib/api/types";

/** English, for the module-level facts below and for callers with no provider. */
const EN = makeTranslate(DEFAULT_LOCALE);

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
 * a literal — there is no name constant to source, and "Starter" / "Pro" are
 * product names that are the same in every language.
 */
function planFacts(
  id: PlanId,
  name: string,
  currency: BillingCurrency,
  t: Translate,
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
    included: t("appShell.planIncluded"),
    seats: t("appShell.planSeats", { count: p.seats }),
    numbers:
      p.numbers === 1
        ? t("appShell.planNumbersOne", { count: p.numbers })
        : t("appShell.planNumbersMany", { count: p.numbers }),
    // #121: the concrete rate lives in the fair-use policy the card links to.
    overage: t("appShell.planOverage"),
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
 *
 * `t` defaults to English for the module-level `PLAN_FACTS` below and for the
 * unit tests, which read the figures rather than the words.
 */
export function planFactsFor(
  currency: unknown,
  t: Translate = EN,
): Record<PlanId, PlanFacts> {
  const c = billingCurrencyOf(currency);
  return {
    starter: planFacts("starter", "Starter", c, t),
    pro: planFacts("pro", "Pro", c, t),
  };
}

/**
 * The USD facts in English, for surfaces that have no company in hand.
 *
 * Module-level, so it cannot read a reader's locale — the one product caller
 * (`components/settings/pause-plan.tsx`) uses only `.name`, which is a product
 * name and identical in both languages.
 */
export const PLAN_FACTS: Record<PlanId, PlanFacts> = planFactsFor("usd");
