import { describe, expect, it } from "vitest";

import {
  describeModuleToggle,
  formatMonthlyCents,
  planModuleCardFromApi,
} from "./module-billing";

describe("formatMonthlyCents", () => {
  it("drops cents on whole dollars and keeps them otherwise", () => {
    expect(formatMonthlyCents(500)).toBe("$5");
    expect(formatMonthlyCents(800)).toBe("$8");
    expect(formatMonthlyCents(750)).toBe("$7.50");
    expect(formatMonthlyCents(1)).toBe("$0.01");
  });
});

describe("describeModuleToggle (#45 confirmation flow)", () => {
  it("enabling states the monthly price AND the prorated charge landing today", () => {
    const change = describeModuleToggle({
      label: "Picture messages",
      monthlyCents: 500,
      enable: true,
    });
    expect(change.title).toBe("Add Picture messages?");
    expect(change.summary).toContain("$5/month");
    expect(change.summary).toContain("prorated");
    expect(change.summary).toContain("today");
    expect(change.confirmLabel).toBe("Add for $5/mo");
  });

  it("disabling states the immediate turn-off and a CONDITIONAL prorated credit", () => {
    const change = describeModuleToggle({
      label: "Call forwarding",
      monthlyCents: 800,
      enable: false,
    });
    expect(change.title).toBe("Turn off Call forwarding?");
    expect(change.summary).toContain("right away");
    expect(change.summary).toContain("not at the end of the period");
    expect(change.summary).toContain("prorated credit");
    expect(change.summary).toContain("$8");
    expect(change.confirmLabel).toBe("Turn off");
  });

  it("never promises a credit unconditionally — grandfathered modules have no Stripe line item and get none", () => {
    // Migrations 20260704160000/20260707140000 seeded legacy companies with
    // free (grandfathered) modules; the API disable path finds no
    // subscription item and makes NO Stripe call, so no credit ever exists.
    // GET /v1/billing/modules doesn't say which cohort a company is in, so
    // the credit sentence must be conditioned on the add-on being billed.
    const change = describeModuleToggle({
      label: "Picture messages",
      monthlyCents: 500,
      enable: false,
    });
    expect(change.summary).toContain("If this add-on is on your bill");
    expect(change.summary).not.toMatch(/The unused part .* comes back/);
  });

  it("never promises a specific dollar amount it cannot know (Stripe computes it)", () => {
    const enable = describeModuleToggle({
      label: "Extra storage",
      monthlyCents: 500,
      enable: true,
    });
    // The only dollar figures are the flat monthly price — the prorated
    // amount is described, not invented.
    const dollarMentions = enable.summary.match(/\$\d+(\.\d+)?/g) ?? [];
    expect(new Set(dollarMentions)).toEqual(new Set(["$5"]));
  });
});

describe("planModuleCardFromApi (#59 single-sourcing)", () => {
  it("projects an API catalog row into the display-card shape", () => {
    expect(
      planModuleCardFromApi({
        id: "voice",
        label: "Call forwarding",
        blurb: "Forward calls to your cell.",
        detail: "300 forwarded minutes a month included.",
        monthly_cents: 800,
      }),
    ).toEqual({
      id: "voice",
      label: "Call forwarding",
      blurb: "Forward calls to your cell.",
      price: "$8",
      detail: "300 forwarded minutes a month included.",
    });
  });

  it("omits the detail line when the API has none", () => {
    const card = planModuleCardFromApi({
      id: "regions_ca",
      label: "Canada numbers",
      blurb: "Get and text Canadian numbers.",
      detail: null,
      monthly_cents: 500,
    });
    expect(card.detail).toBeUndefined();
    expect("detail" in card).toBe(false);
  });
});
