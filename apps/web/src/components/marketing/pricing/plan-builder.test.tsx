import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
} from "@/lib/api/types";
import { PLANS } from "@/app/(marketing)/pricing/pricing-data";

import { PlanBuilder } from "./plan-builder";
import {
  DEFAULT_SELECTION,
  SELLABLE_ADDON_CARDS,
  addonMonthlyDollars,
  firstMonthTotalDollars,
  monthlyTotalDollars,
  signupHref,
} from "./plan-math";

describe("plan-math (owner ruling 13: totals from shared constants, zero retyped numbers)", () => {
  it("sells exactly the API's sellable modules; regions_ca is never offered", () => {
    expect(SELLABLE_ADDON_CARDS.map((card) => card.id)).toEqual([
      "mms",
      "voice",
      "extra_storage",
    ]);
  });

  it("parses every sellable price out of the catalog mirror itself", () => {
    // The catalog says $5 / $8 / $5 (as of 2026-07-07); the parser must read
    // those strings, not carry its own copy.
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(`$${addonMonthlyDollars(card)}`).toBe(card.price);
    }
  });

  it("throws on an unparseable catalog price instead of rendering a wrong total", () => {
    expect(() =>
      addonMonthlyDollars({
        id: "mms",
        label: "Broken",
        blurb: "",
        price: "call us",
      }),
    ).toThrow(/Unparseable/);
  });

  it("defaults to the SSR state the owner ruled: Starter, no add-ons", () => {
    expect(DEFAULT_SELECTION).toEqual({ plan: "starter", addons: [] });
    expect(monthlyTotalDollars(DEFAULT_SELECTION)).toBe(
      PLAN_PRICING.starter.monthlyDollars,
    );
  });

  it("totals plan + enabled add-ons, and first month adds the one-time fee exactly once", () => {
    const everything = {
      plan: "pro",
      addons: ["mms", "voice", "extra_storage"],
    } as const;
    const expected =
      PLAN_PRICING.pro.monthlyDollars +
      SELLABLE_ADDON_CARDS.reduce(
        (sum, card) => sum + addonMonthlyDollars(card),
        0,
      );
    expect(monthlyTotalDollars(everything)).toBe(expected);
    expect(firstMonthTotalDollars(everything)).toBe(
      expected + US_REGISTRATION_FEE_DOLLARS,
    );
    // And the ruling's own arithmetic: Starter first month is $58.
    expect(firstMonthTotalDollars(DEFAULT_SELECTION)).toBe(58);
  });

  it("ignores add-on ids that aren't sellable (no phantom charges)", () => {
    expect(
      monthlyTotalDollars({ plan: "starter", addons: ["regions_ca"] }),
    ).toBe(PLAN_PRICING.starter.monthlyDollars);
  });

  it("carries the chosen configuration into signup, in stable catalog order", () => {
    expect(signupHref(DEFAULT_SELECTION)).toBe("/signup?plan=starter");
    expect(
      signupHref({ plan: "pro", addons: ["extra_storage", "mms"] }),
    ).toBe("/signup?plan=pro&modules=mms%2Cextra_storage");
  });
});

describe("<PlanBuilder> SSR default (complete without JavaScript, zero fake state)", () => {
  const html = renderToStaticMarkup(<PlanBuilder plans={PLANS} />);

  it("renders the default receipt: $29 monthly, + $29 registration, $58 first month", () => {
    expect(html).toContain("$29");
    expect(html).toContain("$58");
    expect(html).toContain("One-time US registration, first month only");
    expect(html).toContain("First month, US shops");
    // The fee is a separate line, never rolled into the monthly figure.
    expect(html).not.toContain("$58/mo");
  });

  it("renders both plans and every sellable add-on with its catalog price", () => {
    for (const plan of PLANS) {
      expect(html).toContain(plan.name);
      expect(html).toContain(plan.price);
    }
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(html).toContain(card.label);
      expect(html).toContain(card.price);
    }
  });

  it("never shows the unsellable regions_ca module", () => {
    const canadaCard = PLAN_MODULE_CARDS.find((c) => c.id === "regions_ca");
    expect(canadaCard).toBeDefined();
    expect(html).not.toContain(canadaCard!.label);
  });

  it("starts with Starter selected and every add-on off (real control state)", () => {
    expect(html).toContain('aria-checked="true"');
    expect(html.match(/role="switch" aria-checked="false"/g)).toHaveLength(3);
    expect(html).not.toContain('role="switch" aria-checked="true"');
  });

  it("the default CTA already carries the default configuration", () => {
    expect(html).toContain('href="/signup?plan=starter"');
  });

  it("keeps the Canada no-fee truth and the guarantee microcopy at the buy button", () => {
    expect(html).toContain(
      "Canadian businesses that don&#x27;t text US numbers never pay the $29",
    );
    expect(html).toContain("30-day money-back guarantee");
  });

  it("has no em-dashes anywhere in the rendered markup (Law 6)", () => {
    expect(html).not.toContain("—");
  });
});
