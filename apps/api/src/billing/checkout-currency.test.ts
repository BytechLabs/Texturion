import type Stripe from "stripe";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkoutCurrency,
  resetCheckoutCurrencyCache,
} from "./checkout-currency";

/**
 * #328 — a checkout that cannot be refused for asking.
 *
 * The CAD price book shipped and released before the Stripe catalog could be
 * updated, because adding a currency to thirteen live prices is an operator
 * action. In that window every new Canadian workspace carried
 * `billing_currency: 'cad'` and would have had its whole Checkout Session
 * refused — Stripe rejects a session whose currency the price does not carry,
 * and on a Canada-first product that is close to every new signup.
 *
 * So the property under test is not "picks the right currency". It is
 * "a customer can always pay".
 */

const PRICE = "price_starter_licensed";

function stripeWith(price: Partial<Stripe.Price>): {
  stripe: Stripe;
  retrieve: ReturnType<typeof vi.fn>;
} {
  const retrieve = vi.fn(async () => price as Stripe.Price);
  return { stripe: { prices: { retrieve } } as unknown as Stripe, retrieve };
}

describe("checkoutCurrency", () => {
  beforeEach(() => {
    resetCheckoutCurrencyCache();
  });

  it("never probes for USD, which every price already carries", async () => {
    const { stripe, retrieve } = stripeWith({ currency: "usd" });

    expect(
      await checkoutCurrency(stripe, { wanted: "usd", licensedPriceId: PRICE }),
    ).toBe("usd");
    expect(retrieve).not.toHaveBeenCalled();
  });

  /**
   * THE ONE THAT MATTERS. This is the live state at the moment the CAD price
   * book released: the workspace wants CAD, the catalog has only USD.
   */
  it("charges USD when the catalog has not gained CAD yet", async () => {
    const { stripe } = stripeWith({ currency: "usd", currency_options: {} });

    expect(
      await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE }),
    ).toBe("usd");
  });

  it("charges CAD the moment the catalog carries it, with no deploy", async () => {
    const { stripe } = stripeWith({
      currency: "usd",
      currency_options: {
        cad: { unit_amount: 3900 },
      } as unknown as Stripe.Price["currency_options"],
    });

    expect(
      await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE }),
    ).toBe("cad");
  });

  it("charges USD when the catalog cannot be read at all", async () => {
    const retrieve = vi.fn(async () => {
      throw new Error("stripe unreachable");
    });
    const stripe = { prices: { retrieve } } as unknown as Stripe;

    // A customer billed in the wrong currency can be moved later. One who
    // could not pay at all is gone.
    expect(
      await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE }),
    ).toBe("usd");
  });

  it("reads a currency this build does not price as no answer", async () => {
    const { stripe } = stripeWith({
      currency: "usd",
      currency_options: {
        gbp: { unit_amount: 2500 },
      } as unknown as Stripe.Price["currency_options"],
    });

    // A GBP option says nothing about CAD, and `billingCurrencyOf` folding it
    // to "usd" must not be mistaken for CAD being available.
    expect(
      await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE }),
    ).toBe("usd");
  });

  it("reads the catalog once per price, not once per checkout", async () => {
    const { stripe, retrieve } = stripeWith({
      currency: "usd",
      currency_options: {
        cad: { unit_amount: 3900 },
      } as unknown as Stripe.Price["currency_options"],
    });

    await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE });
    await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE });

    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("treats a price whose own base currency is CAD as chargeable in CAD", async () => {
    // Not how the catalog is built today, but the base currency is always
    // chargeable and reading only `currency_options` would miss it.
    const { stripe } = stripeWith({ currency: "cad" });

    expect(
      await checkoutCurrency(stripe, { wanted: "cad", licensedPriceId: PRICE }),
    ).toBe("cad");
  });

  it("falls back to USD for a stored value it does not recognise", async () => {
    const { stripe, retrieve } = stripeWith({ currency: "usd" });

    expect(
      await checkoutCurrency(stripe, { wanted: null, licensedPriceId: PRICE }),
    ).toBe("usd");
    expect(
      await checkoutCurrency(stripe, { wanted: "gbp", licensedPriceId: PRICE }),
    ).toBe("usd");
    expect(retrieve).not.toHaveBeenCalled();
  });
});
