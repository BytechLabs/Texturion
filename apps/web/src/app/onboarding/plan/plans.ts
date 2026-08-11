import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { PLAN_PRICING } from "@/lib/api/types";
import type { PlanId } from "@/lib/api/types";

/** English, for the module-level cards below and for the unit tests. */
const EN = makeTranslate(DEFAULT_LOCALE);

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
function planCard(
  id: PlanId,
  name: string,
  crewLine: string,
  t: Translate,
): PlanCard {
  const p = PLAN_PRICING[id];
  return {
    id,
    name,
    price: `$${p.monthlyDollars}`,
    // 30 days, not 30.44: a round month is what somebody checks on their
    // fingers, and being a cent optimistic about our own price is the wrong
    // direction to be imprecise in.
    daily: t("onboarding.planCardDaily", {
      amount: `$${(p.monthlyDollars / 30).toFixed(2)}`,
    }),
    lines: [
      t("onboarding.planCardTextingIncluded"),
      crewLine,
      p.numbers === 1
        ? t("onboarding.planCardNumbersOne", { count: p.numbers })
        : t("onboarding.planCardNumbersMany", { count: p.numbers }),
      t("onboarding.planCardIncomingFree"),
      // #121: no per-text price in sales copy; the rate lives in the
      // fair-use policy the plan step links to.
      t("onboarding.planCardOverage"),
    ],
  };
}

/**
 * The two cards, in the reader's language.
 *
 * A function rather than the module-level constant this replaces: a constant is
 * built once, before any locale is known, so it would have pinned whichever
 * language happened to load the module first for everybody after. "Starter" and
 * "Pro" stay literals — they are product names, identical in both.
 */
export function planCards(t: Translate = EN): PlanCard[] {
  return [
    planCard(
      "starter",
      "Starter",
      t("onboarding.planCardCrewStarter", {
        seats: PLAN_PRICING.starter.seats,
      }),
      t,
    ),
    planCard(
      "pro",
      "Pro",
      t("onboarding.planCardCrewPro", { seats: PLAN_PRICING.pro.seats }),
      t,
    ),
  ];
}

/** The English cards, for the unit tests that read the derived figures. */
export const PLANS: PlanCard[] = planCards();
