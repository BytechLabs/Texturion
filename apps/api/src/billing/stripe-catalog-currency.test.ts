import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BILLING_CURRENCIES,
  OVERAGE_CENTS_PER_SEGMENT,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { SELLABLE_MODULES } from "./company-modules";
import { PLAN_PREPAY_YEAR_CENTS } from "./plans";

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
  ["prepaid year Starter USD", PLAN_PREPAY_YEAR_CENTS.usd.starter],
  ["prepaid year Starter CAD", PLAN_PREPAY_YEAR_CENTS.cad.starter],
  ["prepaid year Pro USD", PLAN_PREPAY_YEAR_CENTS.usd.pro],
  ["prepaid year Pro CAD", PLAN_PREPAY_YEAR_CENTS.cad.pro],
];

/**
 * The body of one `ensurePrice("<lookupKey>", { … })` call, by brace matching.
 *
 * A whole-file substring search cannot tell WHICH price an amount or a
 * `currency_options` block belongs to, and that is precisely how #522 got
 * through: the file contained six `currency_options:` and the count guard was
 * satisfied while the two prepaid-year prices had none. Per price, or the guard
 * proves nothing about the price that is actually broken.
 */
function priceBody(lookupKey: string): string {
  const call = SCRIPT.indexOf(`ensurePrice("${lookupKey}"`);
  if (call === -1) throw new Error(`no ensurePrice("${lookupKey}") in the script`);
  const open = SCRIPT.indexOf("{", call);
  let depth = 0;
  for (let i = open; i < SCRIPT.length; i += 1) {
    if (SCRIPT[i] === "{") depth += 1;
    else if (SCRIPT[i] === "}") {
      depth -= 1;
      if (depth === 0) return SCRIPT.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ensurePrice("${lookupKey}")`);
}

/**
 * Every price a customer's money can reach, and the CAD amount it must carry.
 *
 * The two prepaid-year prices are the #522 entries. A one-time price with no
 * CAD option does not fail loudly — Stripe charges its base currency — so a
 * Canadian workspace was shown a figure it read as CAD and billed that many US
 * dollars instead.
 */
const CHARGEABLE_PRICES: [lookupKey: string, cadCents: number | null][] = [
  ["loonext_starter_licensed", PLAN_PRICE_CENTS.cad.starter],
  ["loonext_pro_licensed", PLAN_PRICE_CENTS.cad.pro],
  // The overage meters are tiered, so their CAD amount lives inside `tiers`
  // rather than a `unit_amount` — asserted by the per-segment test below.
  ["loonext_starter_overage", null],
  ["loonext_pro_overage", null],
  ["loonext_us_registration", US_REGISTRATION_FEE_CENTS.cad],
  ["loonext_starter_year", PLAN_PREPAY_YEAR_CENTS.cad.starter],
  ["loonext_pro_year", PLAN_PREPAY_YEAR_CENTS.cad.pro],
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

  it.each(CHARGEABLE_PRICES)(
    "gives %s a CAD option, on that price and not merely somewhere in the file",
    (lookupKey, cadCents) => {
      const body = priceBody(lookupKey);
      expect(
        /currency_options:\s*\{\s*cad:/.test(body),
        `${lookupKey} files no CAD amount. A recurring price with no CAD ` +
          `option makes Stripe refuse the whole checkout session; a ONE-TIME ` +
          `price with no CAD option is worse, because it does not refuse — it ` +
          `quietly charges its base currency, so a workspace shown "$290" pays ` +
          `US$290 (#522).`,
      ).toBe(true);
      if (cadCents !== null) {
        expect(body, `${lookupKey} files the wrong CAD amount`).toContain(
          `unit_amount: ${cadCents}`,
        );
      }
    },
  );

  /**
   * #522 — the module prices, whose USD-only state is a DECISION.
   *
   * `regions_ca` is the only module and it is not sellable, so no CAD figure
   * has ever been decided for it and inventing one to make a guard pass would
   * file a price nobody chose. This asserts the pair: as long as nothing is
   * sellable, USD-only is fine. The moment a module becomes sellable this fails
   * — which is the moment it matters, because Stripe refuses a subscription
   * item whose price carries no option in the subscription's currency, so a
   * Canadian workspace could not add it at all.
   */
  it("keeps a sellable module chargeable in every currency", () => {
    for (const module of SELLABLE_MODULES) {
      const body = priceBody(`loonext_module_${module}_licensed`);
      for (const currency of BILLING_CURRENCIES) {
        if (currency === "usd") continue;
        expect(
          body.includes(`${currency}:`),
          `the ${module} module is now sellable but its Stripe price files no ` +
            `${currency} amount. A ${currency} subscription cannot take a price ` +
            `that has no ${currency} option — the add-on toggle fails outright ` +
            `for every workspace billed in it. Decide the figure, put it in ` +
            `MODULE_CATALOG with a currency axis, and file it here.`,
        ).toBe(true);
      }
    }
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
