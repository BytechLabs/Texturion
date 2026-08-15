/**
 * #464. These vectors are shared with the Kotlin port
 * (NumbersSection.extraNumberBlockedReason) — a client that disagrees with the
 * server either hides a purchase the server would allow, or offers one it
 * would refuse and turns a tap into an error.
 */
import { describe, expect, it } from "vitest";

import {
  canBuyExtraNumber,
  EXTRA_NUMBER_CURRENCY,
  extraNumberBlockedReason,
  STARTER_MAX_TOTAL_NUMBERS,
  type ExtraNumberEligibility,
} from "./extra-numbers";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


describe("extraNumberBlockedReason", () => {
  it("lets a Canadian workspace buy one, with no registration wait", () => {
    // The bug: Canada has no 10DLC equivalent, so `usTextingEnabled` is never
    // true for a CA workspace — and the old rule required it, which refused
    // every Canadian customer forever.
    expect(
      extraNumberBlockedReason({
        plan: "pro",
        currentCount: 2,
        country: "CA",
        usTextingEnabled: false,
        billingCurrency: "usd",
      }, sayEn),
    ).toBeNull();
  });

  it("makes a US workspace wait for carrier approval", () => {
    const reason = extraNumberBlockedReason({
      plan: "pro",
      currentCount: 2,
      country: "US",
      usTextingEnabled: false,
      billingCurrency: "usd",
    }, sayEn);
    expect(reason).toBe(
      "An extra number needs US texting turned on for your workspace first.",
    );
  });

  it("lets an approved US workspace buy one", () => {
    expect(
      canBuyExtraNumber({
        plan: "pro",
        currentCount: 2,
        country: "US",
        usTextingEnabled: true,
        billingCurrency: "usd",
      }),
    ).toBe(true);
  });

  it("keeps Starter's hard total cap, in both countries", () => {
    for (const country of ["US", "CA"] as const) {
      const reason = extraNumberBlockedReason({
        plan: "starter",
        currentCount: STARTER_MAX_TOTAL_NUMBERS,
        country,
        usTextingEnabled: true,
        billingCurrency: "usd",
      }, sayEn);
      expect(reason, `${country} should still hit the Starter cap`).toContain(
        "Starter tops out",
      );
    }
  });

  it("lets Starter buy its ONE extra", () => {
    expect(
      canBuyExtraNumber({
        plan: "starter",
        currentCount: 1,
        country: "CA",
        usTextingEnabled: false,
        billingCurrency: "usd",
      }),
    ).toBe(true);
  });

  it("never returns an empty explanation", () => {
    // The string is the only thing the customer is told, so a blocked case
    // that says nothing is worse than no gate at all.
    const blocked = [
      { plan: "us-unapproved", args: { plan: "pro" as const, currentCount: 2, country: "US" as const, usTextingEnabled: false, billingCurrency: "usd" } },
      { plan: "starter-capped", args: { plan: "starter" as const, currentCount: 2, country: "CA" as const, usTextingEnabled: false, billingCurrency: "usd" } },
    ];
    for (const { plan, args } of blocked) {
      const reason = extraNumberBlockedReason(args, sayEn);
      expect(reason, `${plan} must explain itself`).toBeTruthy();
      expect(reason!.length, `${plan} must explain itself`).toBeGreaterThan(20);
    }
  });
});

/**
 * #522 — a Stripe subscription bills in ONE currency, and every item on it has
 * to carry an amount in that currency. The extra-number prices are filed in USD
 * only, and no CAD figure exists to file: the CAD book was priced item by item
 * with five different ratios, so there is no rule that yields one for a $5 line.
 *
 * So the honest answer is a sentence, not a failed charge. These tests pin BOTH
 * halves — that it refuses, and that it refuses nobody it shouldn't.
 */
describe("extra numbers are a USD line (#522)", () => {
  const canadianPro = {
    plan: "pro" as const,
    currentCount: 2,
    country: "CA" as const,
    usTextingEnabled: false,
  };

  it("refuses a workspace billed in another currency, and says why", () => {
    const reason = extraNumberBlockedReason({
      ...canadianPro,
      billingCurrency: "cad",
    }, sayEn);
    expect(reason).toContain("US dollars");
    // Names a way forward rather than stopping at "unavailable".
    expect(reason).toContain("support");
  });

  it("allows the same workspace when USD is what it is actually charged", () => {
    // The state of every workspace today, Canadian ones included: the catalog
    // is USD-only, so checkout records `usd` whatever the country suggested.
    // A country-based gate would have refused this sale for no reason.
    expect(
      canBuyExtraNumber({ ...canadianPro, billingCurrency: "usd" }),
    ).toBeTruthy();
  });

  it("is not fooled by case or padding", () => {
    expect(
      canBuyExtraNumber({ ...canadianPro, billingCurrency: " USD " }),
    ).toBeTruthy();
    expect(
      canBuyExtraNumber({ ...canadianPro, billingCurrency: "CAD" }),
    ).toBe(false);
  });

  it("keys on the CHARGED currency, never on the country", () => {
    // The distinction the whole issue turned on. A Canadian workspace is not a
    // CAD workspace — `companies.billing_currency` is, and it is written from
    // what Stripe actually charged.
    expect(
      canBuyExtraNumber({
        ...canadianPro,
        country: "US",
        usTextingEnabled: true,
        billingCurrency: "cad",
      }),
    ).toBe(false);
  });

  it("agrees with the constant it is enforcing", () => {
    // If someone files a CAD amount and updates the constant, this gate must
    // stop firing rather than needing to be found and deleted.
    expect(
      canBuyExtraNumber({
        ...canadianPro,
        billingCurrency: EXTRA_NUMBER_CURRENCY,
      }),
    ).toBeTruthy();
  });
});

describe("#228 the refusal a Quebec workspace reads", () => {
  it("says why in French, and fills the cap in", () => {
    const starter = extraNumberBlockedReason(
      {
        plan: "starter",
        currentCount: STARTER_MAX_TOTAL_NUMBERS,
        country: "US",
        usTextingEnabled: true,
        billingCurrency: "usd",
      } satisfies ExtraNumberEligibility,
      sayFr,
    );
    expect(starter).toMatch(/^Le forfait Starter/);
    expect(starter).toContain(String(STARTER_MAX_TOTAL_NUMBERS));
    expect(starter, "a variable survived the fill").not.toMatch(/\{/);
  });

  it("keeps the remedy in both languages, because a refusal without one reads as a bug", () => {
    // Every branch here names what would have to change. That is the rule the
    // module's own docblock states, and a translation that dropped the second
    // half would leave a workspace refused with nothing to do about it.
    const args: ExtraNumberEligibility = {
      plan: "pro",
      currentCount: 3,
      country: "US",
      usTextingEnabled: false,
      billingCurrency: "usd",
    };
    expect(extraNumberBlockedReason(args, sayEn)).toMatch(/turned on/i);
    expect(extraNumberBlockedReason(args, sayFr)).toMatch(/activ[ée]s/i);

    const currency = { ...args, usTextingEnabled: true, billingCurrency: "cad" };
    expect(extraNumberBlockedReason(currency, sayEn)).toMatch(/Contact support/i);
    expect(extraNumberBlockedReason(currency, sayFr)).toMatch(/soutien/i);
  });

  it("still answers yes or no without a resolver", () => {
    // canBuyExtraNumber defaults to a resolver that returns the key: the
    // boolean is what it is for, and a caller that printed the reason would
    // see something obviously unfinished rather than a plausible sentence.
    expect(
      canBuyExtraNumber({
        plan: "pro",
        currentCount: 3,
        country: "US",
        usTextingEnabled: true,
        billingCurrency: "usd",
      } satisfies ExtraNumberEligibility),
    ).toBe(true);
  });
});
