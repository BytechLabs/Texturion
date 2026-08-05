import type Stripe from "stripe";

import { billingCurrencyOf, type BillingCurrency } from "@loonext/shared";

/**
 * #328 — the currency a checkout session may actually be created in.
 *
 * # Why this is not just the company's own column
 *
 * A Stripe Price carries an amount per currency (`currency_options`), and a
 * Checkout Session that asks for a currency the price does not carry is
 * REFUSED — the whole session, not the one line. So the company's stored
 * currency is what it should be charged in, and this is what the catalog can
 * presently honour. Until those agree, the second one wins, because the
 * alternative is a customer who cannot pay at all.
 *
 * # The failure this exists to prevent, which was live
 *
 * The CAD price book shipped and released before the Stripe catalog was
 * updated — adding a currency to thirteen live prices is an operator action
 * (`stripe:setup`), and it had not been run. Every new Canadian workspace was
 * being created with `billing_currency: 'cad'` and would then have had its
 * checkout refused by Stripe. On a Canada-first product that is close to every
 * new signup.
 *
 * Code that assumes an operator has already run something is code that breaks
 * in the window before they do. This checks instead.
 *
 * # It heals itself
 *
 * The moment the catalog gains its CAD options, this starts returning `cad`
 * with no deploy and no flag to remember. And if the catalog is ever rolled
 * back, checkout keeps working rather than failing closed on a currency that
 * has gone away.
 *
 * # Cost
 *
 * One `prices.retrieve` per checkout, cached per isolate for the lifetime of
 * the Worker. A checkout is a rare, deliberate, already-slow action, and the
 * alternative to the read is a guess about somebody else's catalog.
 */

/**
 * Per-isolate memo: price id → the currencies it can be charged in.
 *
 * Scoped to the id rather than global so a catalog change is picked up by the
 * next cold isolate, which is minutes rather than a deploy. Deliberately NOT
 * negative-cached forever for the same reason: this is a fact about a remote
 * object we do not own.
 */
const currenciesByPrice = new Map<string, Set<BillingCurrency>>();

/** Exposed only so tests can start from a known state. */
export function resetCheckoutCurrencyCache(): void {
  currenciesByPrice.clear();
}

/**
 * The currencies `priceId` can be charged in, read from Stripe.
 *
 * Always includes the price's own base currency. Returns null when the price
 * cannot be read at all, which the caller treats as "do not gamble".
 */
async function currenciesFor(
  stripe: Stripe,
  priceId: string,
): Promise<Set<BillingCurrency> | null> {
  const memo = currenciesByPrice.get(priceId);
  if (memo) return memo;
  try {
    const price = await stripe.prices.retrieve(priceId, {
      expand: ["currency_options"],
    });
    const found = new Set<BillingCurrency>();
    // The base currency is always chargeable, whether or not the account has
    // ever configured an option for it.
    const base = billingCurrencyOf(price.currency);
    found.add(base);
    for (const code of Object.keys(price.currency_options ?? {})) {
      if (code === base) continue;
      const known = billingCurrencyOf(code);
      // `billingCurrencyOf` falls back to usd, so only trust an exact match —
      // otherwise a GBP option would read as "usd is available", which it
      // already is, harmlessly, but the reasoning would be wrong.
      if (known === code) found.add(known);
    }
    currenciesByPrice.set(priceId, found);
    return found;
  } catch (cause) {
    // A price we cannot read is not a price we should guess about.
    console.error(
      `checkout currency probe failed for ${priceId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return null;
  }
}

/**
 * Can this price actually be charged in `wanted`?
 *
 * # Why this is not `checkoutCurrency(...) === wanted` (#522)
 *
 * Because the two questions have different right answers, and `checkoutCurrency`
 * answers the OTHER one. Its fallback — charge USD rather than have the session
 * refused — is correct for the subscription checkout, where the alternative is a
 * customer who cannot pay at all and is gone.
 *
 * It is wrong for an OPTIONAL offer. A workspace that cannot buy a prepaid year
 * today still has its plan, its number and its crew; nothing is lost by not
 * offering it. What IS lost by offering it anyway is the thing #522 is about:
 * the surface quotes a figure in the workspace's currency and Stripe collects
 * that many US dollars. A one-time price does not refuse an unfilled currency
 * the way a subscription price does — it silently bills its base currency — so
 * "charge USD anyway" here is not a graceful degradation, it is the defect.
 *
 * False whenever the catalog cannot be READ, too. A price we could not reach is
 * not a price we may quote in somebody's own money on a guess.
 */
export async function canChargeIn(
  stripe: Stripe,
  args: { wanted: BillingCurrency; priceId: string },
): Promise<boolean> {
  if (args.wanted === "usd") return true;
  const available = await currenciesFor(stripe, args.priceId);
  return available?.has(args.wanted) ?? false;
}

/**
 * What to pass as the session's `currency`.
 *
 * `wanted` is the workspace's own stored currency. The return is what the
 * catalog can honour today, which is the same thing whenever the two agree.
 */
export async function checkoutCurrency(
  stripe: Stripe,
  args: { wanted: unknown; licensedPriceId: string },
): Promise<BillingCurrency> {
  const wanted = billingCurrencyOf(args.wanted);
  // USD is every price's base currency here and needs no probe.
  if (wanted === "usd") return "usd";

  const available = await currenciesFor(stripe, args.licensedPriceId);
  if (available === null) {
    // Could not read the catalog. Charge in the currency that has always
    // worked rather than risk a refused session — a customer billed in the
    // wrong currency can be moved; one who could not pay at all is gone.
    console.error(
      `checkout falling back to usd: could not read ${args.licensedPriceId}`,
    );
    return "usd";
  }
  if (available.has(wanted)) return wanted;

  // The catalog has not caught up. Loud, because this is a real gap between
  // what a workspace was promised and what it will be charged, and somebody
  // has to run `pnpm --filter @loonext/api stripe:setup` to close it.
  console.error(
    `checkout wanted ${wanted} but ${args.licensedPriceId} offers only ` +
      `${[...available].join(", ")} — run stripe:setup to add it. Charging usd.`,
  );
  return "usd";
}
