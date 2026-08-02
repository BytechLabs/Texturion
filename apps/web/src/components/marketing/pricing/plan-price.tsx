"use client";

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { useCountry } from "@/components/marketing/country/country-context";
import type { PlanId } from "@/lib/api/types";

/**
 * #328 — a price on a marketing page, in the visitor's own currency.
 *
 * Seventeen marketing pages carried "$29" as a literal. Every one of them was
 * a promise to a Canadian reader that the checkout then broke, and the drift
 * was invisible because a literal never disagrees with itself — it disagrees
 * with the invoice, months later, in front of somebody holding a card.
 *
 * # No new state
 *
 * The site already knows: `useCountry()` is the same signal the pricing
 * dateline, the registration-fee copy and the trade pages branch on today.
 * Currency follows country rather than adding a selector, because a visitor
 * who has already told us where they are should not be asked twice, and a
 * second control is a second thing that can disagree with the first.
 *
 * # Whose dollar sign
 *
 * Unprefixed, always. A marketing page is read by somebody in one country at a
 * time, and the currency their country implies is the one "$" means to them.
 * `formatMoney`'s prefix exists for surfaces that show a FOREIGN price beside a
 * local one — the comparison pages — and this is not that.
 */

/** The currency a marketing visitor should see, from the country they chose. */
export function useMarketingCurrency(): BillingCurrency {
  const { country } = useCountry();
  return country === "ca" ? "cad" : "usd";
}

/**
 * The monthly price of a plan, formatted.
 *
 * A component rather than a helper so a page cannot forget the country: there
 * is no argument to pass wrongly, and nothing renders until the provider is
 * above it.
 */
export function PlanPrice({ plan }: { plan: PlanId }) {
  const currency = useMarketingCurrency();
  return <>{formatMoney(PLAN_PRICE_CENTS[currency][plan], currency)}</>;
}

/**
 * The one-time US registration fee.
 *
 * Only ever rendered inside a US branch — a Canadian workspace texting
 * Canadian customers never pays it, which the surrounding copy already says.
 * It carries a currency anyway because a Canadian company CAN enable US
 * texting, and then it is charged on a Canadian invoice.
 */
export function RegistrationFee() {
  const currency = useMarketingCurrency();
  return <>{formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency)}</>;
}

/**
 * First month for a US workspace: the plan plus the one-time fee.
 *
 * Derived rather than written, because "$58 your first month" is the figure
 * most likely to be quietly wrong — it is the only one on the page that is a
 * sum, so it is the only one that can drift without either of its parts
 * changing.
 */
export function FirstMonthTotal({ plan }: { plan: PlanId }) {
  const currency = useMarketingCurrency();
  const total =
    PLAN_PRICE_CENTS[currency][plan] + US_REGISTRATION_FEE_CENTS[currency];
  return <>{formatMoney(total, currency)}</>;
}
