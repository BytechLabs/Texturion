import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  OVERAGE_CENTS_PER_SEGMENT,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

/**
 * #328 — the Stripe catalog script files the same figures the product quotes.
 *
 * `apps/api/scripts/stripe-setup.ts` cannot import `@loonext/shared`: it builds
 * under the scripts tsconfig, which uses node16 module resolution, and the
 * shared barrel's extensionless relative imports do not resolve there. So the
 * amounts are inlined — and an inlined price is a price that can drift from the
 * one on the pricing page, in the direction of charging somebody something we
 * never advertised.
 *
 * This reads the script as TEXT and asserts every figure appears. It is the
 * same shape as the `scrub.ts` duplication guard: a test file has none of the
 * resolution constraints the thing it guards has, so the import that cannot
 * exist in the module can exist in its test.
 */

const SCRIPT = readFileSync(
  fileURLToPath(new URL("../../scripts/stripe-setup.ts", import.meta.url)),
  "utf8",
);

/** Every amount the catalog must file, with the name its failure should say. */
const FIGURES: [label: string, cents: number][] = [
  ["Starter USD", PLAN_PRICE_CENTS.usd.starter],
  ["Starter CAD", PLAN_PRICE_CENTS.cad.starter],
  ["Pro USD", PLAN_PRICE_CENTS.usd.pro],
  ["Pro CAD", PLAN_PRICE_CENTS.cad.pro],
  ["US registration USD", US_REGISTRATION_FEE_CENTS.usd],
  ["US registration CAD", US_REGISTRATION_FEE_CENTS.cad],
];

describe("the Stripe catalog script and the shared price book agree (#328)", () => {
  it.each(FIGURES)("files the %s amount", (label, cents) => {
    expect(
      SCRIPT.includes(String(cents)),
      `${label} is ${cents}¢ in packages/shared/src/billing-currency.ts and ` +
        `does not appear in scripts/stripe-setup.ts. A catalog that files a ` +
        `different number from the one the pricing page quotes charges ` +
        `somebody something we never advertised.`,
    ).toBe(true);
  });

  it("files both per-segment overage rates", () => {
    // Starter's are whole cents; Pro's are fractional and go through
    // `unit_amount_decimal`, so they appear as quoted strings.
    expect(SCRIPT).toContain(
      `unit_amount: ${OVERAGE_CENTS_PER_SEGMENT.usd.starter}`,
    );
    expect(SCRIPT).toContain(
      `unit_amount: ${OVERAGE_CENTS_PER_SEGMENT.cad.starter}`,
    );
    expect(SCRIPT).toContain(`"${OVERAGE_CENTS_PER_SEGMENT.usd.pro}"`);
    expect(SCRIPT).toContain(`"${OVERAGE_CENTS_PER_SEGMENT.cad.pro}"`);
  });

  it("gives every recurring and one-time price a CAD option", () => {
    // Four prices a customer is actually charged: the two licensed plans, the
    // two overage meters, plus the registration fee. A price with no CAD option
    // is a line item that would refuse a CAD session at checkout.
    const options = SCRIPT.match(/currency_options:/g) ?? [];
    expect(
      options.length,
      "every price a CAD session can reach needs a cad option, or Stripe " +
        "refuses the whole session",
    ).toBeGreaterThanOrEqual(5);
  });

  /**
   * The reconcile, which is the part that is easy to leave out.
   *
   * The 13 prices already live in Stripe were created before CAD existed.
   * `ensurePrice` finds them by lookup key, and a plain "reusing" would leave
   * every one of them USD-only while the script printed success.
   */
  it("adds a missing currency to a price that already exists", () => {
    expect(SCRIPT).toContain("stripe.prices.update");
    // ...and expands the field, or the check that drives it reads undefined
    // and re-adds CAD on every run.
    expect(SCRIPT).toContain('expand: ["data.currency_options"]');
  });

  it("never overwrites an amount already filed for a currency", () => {
    // Changing a live price is a pricing decision. It must not happen as a
    // side effect of somebody re-running setup.
    expect(SCRIPT).toContain("!found.currency_options?.[code]");
  });
});
