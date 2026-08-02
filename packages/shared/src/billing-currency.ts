import type { SeatPlan } from "./seats";

/**
 * #328 — what a Canadian customer is charged in, and in what.
 *
 * # The problem this closes
 *
 * We sell Canada-first — CASL, Canadian number handling, a `regions_ca` module
 * — and then billed a plumber in Hamilton in a foreign currency. Three costs,
 * in order of how much they actually matter: the bill moves with the exchange
 * rate every month, which is the sort of drift that gets a subscription
 * cancelled during a bad month; the customer's issuer adds roughly 2.5% we
 * neither receive nor disclose; and checkout contradicts the pitch at the worst
 * possible point in the funnel.
 *
 * # Why now, when the conversion data cannot justify it
 *
 * #328 asked for evidence that FX friction costs conversions before building.
 * Live Stripe on 2026-08-02 held ONE customer and six checkout sessions ever,
 * so that question is unanswerable — five expired sessions out of six means
 * nothing, and several were the founder's own testing.
 *
 * But the same number inverts the objection. The devil's advocate was about
 * ONGOING complexity, and that cost is at its lifetime minimum today:
 * grandfathering is one subscription rather than a migration, and #255's margin
 * work and #327's revenue reporting are cheaper to build currency-aware than to
 * retrofit onto a year of USD-only history. The evidence that would justify it
 * is unavailable, and the price of doing it only goes up.
 *
 * # The figures are DECIDED, not converted
 *
 * A converted number ($29 → $39.73) reads as an afterthought and moves every
 * time the rate does. These are round and locally sensible, and they all end in
 * 9 like the USD ones do.
 *
 * They sit slightly BELOW a straight conversion, and that is a decision rather
 * than an oversight — see `MAX_FX_ABSORPTION` for exactly how much we absorb
 * and why the number is bounded instead of arbitrary.
 *
 * # FX risk moves to us, and that is the correct place for it
 *
 * Every cost we carry is USD-denominated — Telnyx, Cloudflare, Supabase — so
 * CAD revenue means we absorb the drift. We can hedge a few points; a one-truck
 * plumber cannot. But it is a real margin change rather than a relabelling,
 * which is why `planRevenueUsdCents` exists and why nothing in the cost model
 * may read a CAD figure as though it were USD.
 */

/** The currencies a workspace can be billed in. Lowercase, as Stripe wants. */
export const BILLING_CURRENCIES = ["usd", "cad"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

/** The currency a workspace gets when nothing else is known. */
export const DEFAULT_BILLING_CURRENCY: BillingCurrency = "usd";

/**
 * Flat monthly plan price, in the minor unit of each currency.
 *
 * CAD is set, not converted:
 *   starter  $29 USD → $39 CAD   (a straight 1.37 conversion is $39.73)
 *   pro      $79 USD → $109 CAD  (a straight conversion is $108.23)
 *
 * Both land a little UNDER a straight conversion, so in real terms a Canadian
 * plan earns marginally less than its US twin. That is the drift #328 says we
 * should absorb rather than push onto a one-truck plumber, and
 * `MAX_FX_ABSORPTION` is what keeps "a few points" from quietly becoming a
 * discount. Repricing every time the rate moves is the thing this whole change
 * exists to stop, so the buffer lives in the bound, not in the figure.
 */
export const PLAN_PRICE_CENTS: Record<BillingCurrency, Record<SeatPlan, number>> =
  {
    usd: { starter: 2900, pro: 7900 },
    cad: { starter: 3900, pro: 10900 },
  };

/**
 * The one-time US texting registration fee.
 *
 * Charged once ever, and only to a workspace that turns on US texting. A
 * Canadian workspace texting Canadian customers never pays it — which is why
 * the CAD figure exists at all: a Canadian company CAN enable US texting.
 */
export const US_REGISTRATION_FEE_CENTS: Record<BillingCurrency, number> = {
  usd: 2900,
  cad: 3900,
};

/**
 * Overage per outgoing segment beyond the plan's allowance, in cents.
 *
 * Kept as a decimal because Stripe meters these with `unit_amount_decimal` and
 * rounding a fraction of a cent per segment is a real number at volume.
 */
export const OVERAGE_CENTS_PER_SEGMENT: Record<
  BillingCurrency,
  Record<SeatPlan, number>
> = {
  usd: { starter: 3, pro: 2.5 },
  cad: { starter: 4, pro: 3.5 },
};

/** Voice overage per minute past the fair-use allowance, in cents. */
export const VOICE_OVERAGE_CENTS_PER_MINUTE: Record<BillingCurrency, number> = {
  usd: 1,
  cad: 1.5,
};

/**
 * The currency a workspace in this country should be offered.
 *
 * A DEFAULT, not a rule. It is what the workspace gets without being asked, and
 * it stays changeable until the first subscription exists — after that the
 * currency is fixed on the Stripe subscription and moving it means cancelling
 * and re-subscribing, which is a support conversation rather than a toggle.
 */
export function currencyForCountry(
  country: string | null | undefined,
): BillingCurrency {
  return country?.trim().toUpperCase() === "CA" ? "cad" : "usd";
}

/** Is this a currency we bill in? Anything else is a stale or hostile value. */
export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return (
    typeof value === "string" &&
    (BILLING_CURRENCIES as readonly string[]).includes(value)
  );
}

/**
 * A stored currency, or the default.
 *
 * Fails to the default rather than throwing: a company row carrying something
 * this build has never heard of must still be able to load its billing screen,
 * and USD is what every existing workspace is already on.
 */
export function billingCurrencyOf(value: unknown): BillingCurrency {
  return isBillingCurrency(value) ? value : DEFAULT_BILLING_CURRENCY;
}

/**
 * "$39" / "US$29" — money for a human, in the currency they are billed in.
 *
 * # Why CAD is the bare "$" and USD is prefixed
 *
 * The reader is a Canadian tradesperson. In Canada "$39" means CAD, and
 * "CA$39" reads as though we expect them to be confused about their own money.
 * The prefix goes on the FOREIGN one, which is the convention every Canadian
 * retailer uses and the honest place for the qualifier: a US price shown to a
 * Canadian must say so, and a Canadian price shown to a Canadian must not.
 *
 * A US customer sees plain "$29", because to them USD is not foreign either —
 * hence `audience`, which is the currency the reader thinks in.
 */
export function formatMoney(
  cents: number,
  currency: BillingCurrency,
  audience: BillingCurrency = currency,
): string {
  const whole = cents / 100;
  // Whole dollars stay whole: "$39", never "$39.00". A trailing ".00" on a
  // plan price reads as machine output and takes up space on a phone.
  const digits = Number.isInteger(whole) ? 0 : 2;
  const amount = whole.toLocaleString("en-CA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (currency === audience) return `$${amount}`;
  return currency === "usd" ? `US$${amount}` : `CA$${amount}`;
}

/**
 * Monthly plan revenue in USD cents, whatever the customer is billed in.
 *
 * THE COST MODEL IS USD-DENOMINATED and must stay that way: Telnyx, Cloudflare
 * and Supabase all bill us in US dollars, so comparing a CAD revenue figure
 * against a USD cost figure would overstate margin by whatever the exchange
 * rate happens to be — roughly 37% at the time of writing, which is more than
 * the margin itself.
 *
 * The rate is a STATED ASSUMPTION rather than a live lookup. A margin model
 * that moved every time it was read would be unusable for the "does this tenant
 * make money" question #255 asks, and a conservative fixed rate answers that
 * question honestly. It is deliberately pessimistic: a lower assumed rate
 * converts CAD revenue into FEWER US cents, so margin is understated rather
 * than flattered.
 */
export const ASSUMED_USD_PER_CAD = 0.72;

/**
 * How much less a CAD plan may earn than its USD twin, in real terms.
 *
 * #328's own framing is the constraint: "we can absorb and hedge a few points
 * of drift; a one-truck plumber cannot". A few points is not the same as a
 * structural discount, and the difference between the two is invisible on the
 * price card — both CAD figures look BIGGER than their USD twins while earning
 * less. So the absorption is bounded and asserted rather than left to whoever
 * next edits the table.
 *
 * At the assumed rate the shipped figures absorb 3.2% (Starter) and 0.7%
 * (Pro). Five percent is the ceiling: past that it stops being drift we chose
 * to eat and becomes a Canadian discount nobody decided on.
 */
export const MAX_FX_ABSORPTION = 0.05;

export function planRevenueUsdCents(
  plan: SeatPlan,
  currency: BillingCurrency,
): number {
  const charged = PLAN_PRICE_CENTS[currency][plan];
  return currency === "usd"
    ? charged
    : Math.round(charged * ASSUMED_USD_PER_CAD);
}
