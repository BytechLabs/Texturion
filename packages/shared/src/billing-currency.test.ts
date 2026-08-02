import { describe, expect, it } from "vitest";

import {
  ASSUMED_USD_PER_CAD,
  MAX_FX_ABSORPTION,
  BILLING_CURRENCIES,
  billingCurrencyOf,
  currencyForCountry,
  formatMoney,
  isBillingCurrency,
  OVERAGE_CENTS_PER_SEGMENT,
  PLAN_PRICE_CENTS,
  planRevenueUsdCents,
  US_REGISTRATION_FEE_CENTS,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
} from "./billing-currency";
import { PLAN_SEATS } from "./seats";

/**
 * #328 — billing a Canadian in Canadian dollars.
 *
 * The tests that matter are not the formatting ones. Charging in CAD moves FX
 * risk from the customer onto us, so the properties worth pinning are the ones
 * that would let a CAD price quietly cost us money: a figure that undercuts its
 * USD twin in real terms, or a revenue number compared against a USD cost as
 * though the two were the same unit.
 */

const PLANS = Object.keys(PLAN_SEATS) as (keyof typeof PLAN_SEATS)[];

describe("the CAD figures are set, not converted", () => {
  it("prices every plan in every currency", () => {
    for (const currency of BILLING_CURRENCIES) {
      for (const plan of PLANS) {
        expect(PLAN_PRICE_CENTS[currency][plan], `${currency}/${plan}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("is a round number in both currencies, never a conversion artefact", () => {
    // A price ending in anything but 00 cents is a converted number that got
    // shipped, which is exactly the "reads as an afterthought" #328 objects to.
    for (const currency of BILLING_CURRENCIES) {
      for (const plan of PLANS) {
        expect(PLAN_PRICE_CENTS[currency][plan] % 100, `${currency}/${plan}`)
          .toBe(0);
      }
      expect(US_REGISTRATION_FEE_CENTS[currency] % 100).toBe(0);
    }
  });

  /**
   * The margin trap, and the reason this file exists.
   *
   * Our costs are USD. A CAD price that converts back to FEWER US cents than
   * the USD price is a discount we did not decide to give, applied only to the
   * market we are trying to win — and it would be invisible, because both
   * numbers look bigger than their USD twins.
   */
  it("absorbs only the few points of drift we decided to, never a discount", () => {
    // This caught the first CAD table I wrote. $39 against a 0.70 assumption
    // earned 5.9% less than $29 in real terms — invisible on the card, because
    // $39 looks like MORE than $29 while earning less.
    for (const plan of PLANS) {
      const usd = PLAN_PRICE_CENTS.usd[plan];
      const cadInUsd = planRevenueUsdCents(plan, "cad");
      const absorbed = (usd - cadInUsd) / usd;
      expect(
        absorbed,
        `${plan}: CAD earns ${cadInUsd}¢ US against ${usd}¢ — absorbing ` +
          `${(absorbed * 100).toFixed(1)}%`,
      ).toBeLessThanOrEqual(MAX_FX_ABSORPTION);
    }
  });

  it("does not overshoot the other way either", () => {
    // A CAD price far ABOVE its USD twin in real terms is the same failure
    // wearing the opposite sign: a Canada-first product charging Canadians a
    // premium for being Canadian.
    for (const plan of PLANS) {
      const usd = PLAN_PRICE_CENTS.usd[plan];
      const premium = (planRevenueUsdCents(plan, "cad") - usd) / usd;
      expect(premium, `${plan} premium`).toBeLessThanOrEqual(MAX_FX_ABSORPTION);
    }
  });

  it("charges more nominal cents in CAD, since a CAD cent is worth less", () => {
    for (const plan of PLANS) {
      expect(PLAN_PRICE_CENTS.cad[plan]).toBeGreaterThan(
        PLAN_PRICE_CENTS.usd[plan],
      );
    }
    expect(US_REGISTRATION_FEE_CENTS.cad).toBeGreaterThan(
      US_REGISTRATION_FEE_CENTS.usd,
    );
    for (const plan of PLANS) {
      expect(OVERAGE_CENTS_PER_SEGMENT.cad[plan]).toBeGreaterThan(
        OVERAGE_CENTS_PER_SEGMENT.usd[plan],
      );
    }
    expect(VOICE_OVERAGE_CENTS_PER_MINUTE.cad).toBeGreaterThan(
      VOICE_OVERAGE_CENTS_PER_MINUTE.usd,
    );
  });

  it("keeps Pro's per-segment overage below Starter's in both currencies", () => {
    // The plan structure has to survive translation: a bigger plan buys a
    // cheaper marginal text, and a CAD table that inverted that would be a
    // pricing change nobody decided.
    for (const currency of BILLING_CURRENCIES) {
      expect(OVERAGE_CENTS_PER_SEGMENT[currency].pro).toBeLessThan(
        OVERAGE_CENTS_PER_SEGMENT[currency].starter,
      );
    }
  });
});

describe("planRevenueUsdCents", () => {
  it("leaves USD alone", () => {
    for (const plan of PLANS) {
      expect(planRevenueUsdCents(plan, "usd")).toBe(PLAN_PRICE_CENTS.usd[plan]);
    }
  });

  // The whole point: a CAD figure must never reach a USD cost comparison at
  // face value. At the assumed rate that would overstate margin by ~43%.
  it("converts CAD down before it can meet a USD cost", () => {
    for (const plan of PLANS) {
      expect(planRevenueUsdCents(plan, "cad")).toBeLessThan(
        PLAN_PRICE_CENTS.cad[plan],
      );
    }
  });

  it("assumes a rate that understates rather than flatters", () => {
    // Pessimistic on purpose: a lower assumed rate converts CAD revenue into
    // fewer US cents, so #255's margin question is answered conservatively.
    expect(ASSUMED_USD_PER_CAD).toBeGreaterThan(0);
    expect(ASSUMED_USD_PER_CAD).toBeLessThan(1);
  });
});

describe("currencyForCountry", () => {
  it("offers a Canadian workspace Canadian dollars", () => {
    expect(currencyForCountry("CA")).toBe("cad");
    expect(currencyForCountry("ca")).toBe("cad");
    expect(currencyForCountry(" CA ")).toBe("cad");
  });

  it("leaves everyone else on USD", () => {
    expect(currencyForCountry("US")).toBe("usd");
    expect(currencyForCountry(null)).toBe("usd");
    expect(currencyForCountry(undefined)).toBe("usd");
    expect(currencyForCountry("")).toBe("usd");
  });
});

describe("billingCurrencyOf", () => {
  it("reads a stored currency", () => {
    expect(billingCurrencyOf("cad")).toBe("cad");
    expect(billingCurrencyOf("usd")).toBe("usd");
  });

  // Every workspace that exists today is on USD, so an unreadable value must
  // land there rather than throw — a billing screen that cannot load is worse
  // than one showing the currency the row was created with.
  it("fails to USD rather than throwing", () => {
    expect(billingCurrencyOf("gbp")).toBe("usd");
    expect(billingCurrencyOf(null)).toBe("usd");
    expect(billingCurrencyOf(42)).toBe("usd");
    expect(isBillingCurrency("gbp")).toBe(false);
  });
});

describe("formatMoney", () => {
  it("shows a Canadian their own money as a plain dollar sign", () => {
    // "CA$39" to a Canadian reads as though we expect them to be confused
    // about their own currency.
    expect(formatMoney(3900, "cad")).toBe("$39");
    expect(formatMoney(2900, "usd")).toBe("$29");
  });

  it("marks the foreign currency, and only the foreign one", () => {
    expect(formatMoney(2900, "usd", "cad")).toBe("US$29");
    expect(formatMoney(3900, "cad", "usd")).toBe("CA$39");
  });

  it("keeps whole dollars whole", () => {
    // "$39.00" on a plan card reads as machine output and costs a phone width.
    expect(formatMoney(10900, "cad")).toBe("$109");
    expect(formatMoney(3950, "cad")).toBe("$39.50");
  });
});
