import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
  type PlanModule,
} from "@/lib/api/types";
import { PLANS } from "@/app/(marketing)/pricing/pricing-data";

import { CountryProvider } from "./country-context";
import { CountryToggle } from "./country-toggle";
import { FirstWeekTimeline } from "./first-week-timeline";
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
  it("sells exactly the API's sellable modules; regions_ca and the retired extra_storage are never offered", () => {
    // #97/#103: no "mms" card — pictures are included, not an add-on.
    // #121: no "extra_storage" card — storage is free.
    expect(SELLABLE_ADDON_CARDS.map((card) => card.id)).toEqual(["voice"]);
  });

  it("parses every sellable price out of the catalog mirror itself", () => {
    // The catalog says $8 (as of 2026-07-10); the parser must read those
    // strings, not carry its own copy.
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(`$${addonMonthlyDollars(card)}`).toBe(card.price);
    }
  });

  it("throws on an unparseable catalog price instead of rendering a wrong total", () => {
    expect(() =>
      addonMonthlyDollars({
        id: "voice",
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
      addons: ["voice"],
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
    // #121: a stale extra_storage intent (old ad, old bookmark) prices as $0.
    // (Double cast: the id is leaving the PlanModule union with the retirement.)
    expect(
      monthlyTotalDollars({
        plan: "starter",
        addons: ["extra_storage" as unknown as PlanModule],
      }),
    ).toBe(PLAN_PRICING.starter.monthlyDollars);
  });

  it("carries the chosen configuration into signup, and never carries a retired module", () => {
    expect(signupHref(DEFAULT_SELECTION)).toBe("/signup?plan=starter");
    expect(signupHref({ plan: "pro", addons: ["voice"] })).toBe(
      "/signup?plan=pro&modules=voice",
    );
    // #121: extra_storage never rides into signup, even from stale state.
    expect(
      signupHref({
        plan: "pro",
        addons: ["extra_storage" as unknown as PlanModule, "voice"],
      }),
    ).toBe("/signup?plan=pro&modules=voice");
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
    // #103/#121: one sellable add-on (voice) — mms and extra_storage retired.
    expect(html.match(/role="switch" aria-checked="false"/g)).toHaveLength(1);
    expect(html).not.toContain('role="switch" aria-checked="true"');
  });

  it("#121: never offers the retired Extra-storage add-on or a storage figure", () => {
    expect(html).not.toContain("Extra storage");
    expect(html).not.toMatch(/\bGB\b/);
  });

  it("the default CTA already carries the default configuration", () => {
    expect(html).toContain('href="/signup?plan=starter"');
  });

  it("US mode shows the plain USD line with no Canadian carve-out, plus the guarantee microcopy", () => {
    expect(html).toContain("Prices in USD, plus sales tax where it applies");
    // US visitors self-selected US; no Canada mention leaks into US mode.
    expect(html).not.toContain("Canadian businesses");
    expect(html).toContain("30-day money-back guarantee");
  });

  it("has no em-dashes anywhere in the rendered markup (Law 6)", () => {
    expect(html).not.toContain("—");
  });
});

describe("<PlanBuilder> country toggle (US default, Canada one tap)", () => {
  const usHtml = renderToStaticMarkup(
    <CountryProvider initialCountry="us">
      <PlanBuilder plans={PLANS} />
    </CountryProvider>,
  );
  const caHtml = renderToStaticMarkup(
    <CountryProvider initialCountry="ca">
      <PlanBuilder plans={PLANS} />
    </CountryProvider>,
  );

  it("US view: the $29 registration fee is its own first-month line and the first month is $58", () => {
    expect(usHtml).toContain("One-time US registration, first month only");
    expect(usHtml).toContain("First month, US shops");
    expect(usHtml).toContain("$58");
    // Never rolled into the monthly figure.
    expect(usHtml).not.toContain("$58/mo");
  });

  it("Canada view: no registration fee, no $58 first month, first month equals the monthly total", () => {
    expect(caHtml).not.toContain("One-time US registration, first month only");
    expect(caHtml).not.toContain("First month, US shops");
    expect(caHtml).not.toContain("$58");
    expect(caHtml).toContain("No registration fee in Canada");
    // Base plan price is identical either way (USD, plus tax): $29 monthly.
    expect(caHtml).toContain("$29");
  });

  it("Canada view keeps the CAD-billing honesty line visible (charged in USD for now)", () => {
    expect(caHtml).toContain("CAD billing isn&#x27;t here yet");
    expect(caHtml).toContain("charged in USD");
  });

  it("neither view has an em-dash (Law 6)", () => {
    expect(usHtml).not.toContain("—");
    expect(caHtml).not.toContain("—");
  });
});

describe("<CountryToggle> (a real segmented radiogroup)", () => {
  it("SSR default marks United States checked and Canada unchecked", () => {
    const html = renderToStaticMarkup(
      <CountryProvider>
        <CountryToggle />
      </CountryProvider>,
    );
    expect(html).toContain("United States");
    expect(html).toContain("Canada");
    expect(html).toContain('role="radiogroup"');
    // Two radios, US selected by default.
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('role="radio" aria-checked="true"');
  });

  it("renders the Canada helper when the context is Canada", () => {
    const html = renderToStaticMarkup(
      <CountryProvider initialCountry="ca">
        <CountryToggle />
      </CountryProvider>,
    );
    expect(html).toContain("works the same day");
    expect(html).not.toContain("registration, then US texting");
  });
});

describe("<FirstWeekTimeline> is country-aware", () => {
  it("US default renders the carrier-wait timeline with the YOU ARE HERE tab", () => {
    const html = renderToStaticMarkup(<FirstWeekTimeline />);
    expect(html).toContain("DAYS 1 TO 7");
    expect(html).toContain("You are here");
    expect(html).toContain("3 to 7 business days");
    expect(html).not.toContain("—");
  });

  it("Canada renders the day-one card with no waiting segment", () => {
    const html = renderToStaticMarkup(
      <CountryProvider initialCountry="ca">
        <FirstWeekTimeline />
      </CountryProvider>,
    );
    expect(html).toContain("Day one · No wait");
    expect(html).toContain("same day you sign up");
    // A Canadian never reads about the US carrier wait or the $29 fee.
    expect(html).not.toContain("US carrier review");
    expect(html).not.toContain("3 to 7 business days");
    expect(html).not.toContain("$29");
    expect(html).not.toContain("You are here");
    expect(html).not.toContain("—");
  });
});
