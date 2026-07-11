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
  it("sells exactly the API's sellable modules — nothing today (#134/D42)", () => {
    // #97/#103: no "mms" card — pictures are included, not an add-on.
    // #121: no "extra_storage" card — storage is free.
    // #134/D42: no "voice" card — calling is included on every plan, and
    // regions_ca stays unsellable until multi-region provisioning ships,
    // so the sellable set is empty.
    expect(SELLABLE_ADDON_CARDS).toEqual([]);
  });

  it("parses a catalog price out of the mirror's own string", () => {
    // Canada numbers says $5; the parser must read that string, not carry
    // its own copy.
    const canada = PLAN_MODULE_CARDS.find((c) => c.id === "regions_ca")!;
    expect(`$${addonMonthlyDollars(canada)}`).toBe(canada.price);
  });

  it("throws on an unparseable catalog price instead of rendering a wrong total", () => {
    expect(() =>
      addonMonthlyDollars({
        id: "regions_ca",
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

  it("totals the plan alone, and first month adds the one-time fee exactly once", () => {
    expect(monthlyTotalDollars({ plan: "pro", addons: [] })).toBe(
      PLAN_PRICING.pro.monthlyDollars,
    );
    expect(firstMonthTotalDollars({ plan: "pro", addons: [] })).toBe(
      PLAN_PRICING.pro.monthlyDollars + US_REGISTRATION_FEE_DOLLARS,
    );
    // And the ruling's own arithmetic: Starter first month is $58.
    expect(firstMonthTotalDollars(DEFAULT_SELECTION)).toBe(58);
  });

  it("ignores add-on ids that aren't sellable (no phantom charges)", () => {
    expect(
      monthlyTotalDollars({ plan: "starter", addons: ["regions_ca"] }),
    ).toBe(PLAN_PRICING.starter.monthlyDollars);
    // #121/#134: a stale retired intent (old ad, old bookmark) prices as $0.
    // (Double cast: the ids left the PlanModule union with the retirements.)
    expect(
      monthlyTotalDollars({
        plan: "starter",
        addons: [
          "extra_storage" as unknown as PlanModule,
          "voice" as unknown as PlanModule,
        ],
      }),
    ).toBe(PLAN_PRICING.starter.monthlyDollars);
  });

  it("carries the chosen configuration into signup, and never carries an unsellable or retired module", () => {
    expect(signupHref(DEFAULT_SELECTION)).toBe("/signup?plan=starter");
    expect(signupHref({ plan: "pro", addons: ["regions_ca"] })).toBe(
      "/signup?plan=pro",
    );
    // #121/#134: retired ids never ride into signup, even from stale state.
    expect(
      signupHref({
        plan: "pro",
        addons: [
          "extra_storage" as unknown as PlanModule,
          "voice" as unknown as PlanModule,
        ],
      }),
    ).toBe("/signup?plan=pro");
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

  it("renders both plans with their catalog prices", () => {
    for (const plan of PLANS) {
      expect(html).toContain(plan.name);
      expect(html).toContain(plan.price);
    }
  });

  it("never shows the unsellable regions_ca module", () => {
    const canadaCard = PLAN_MODULE_CARDS.find((c) => c.id === "regions_ca");
    expect(canadaCard).toBeDefined();
    expect(html).not.toContain(canadaCard!.label);
  });

  it("#134/D42: hides the whole add-on step while nothing is sellable", () => {
    // Calling retired into every plan; regions_ca can't be bought yet. No
    // heading over an empty list, and no toggle for anything.
    expect(html).not.toContain("Add only what you need");
    expect(html).not.toContain('role="switch"');
  });

  it("starts with Starter selected (real control state)", () => {
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('role="switch" aria-checked="true"');
  });

  it("#121/#134: never offers the retired add-ons or their figures", () => {
    expect(html).not.toContain("Extra storage");
    expect(html).not.toMatch(/\bGB\b/);
    expect(html).not.toContain("Calling");
    expect(html).not.toContain("$8");
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
