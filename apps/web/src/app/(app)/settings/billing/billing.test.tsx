import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import { PLAN_FACTS } from "./plan-facts";

describe("billing plan facts trace to PLAN_PRICING (findings 6 + 9)", () => {
  it("derives every plan's price from the shared constant", () => {
    expect(PLAN_FACTS.starter.price).toBe(
      `$${PLAN_PRICING.starter.monthlyDollars}/mo`,
    );
    expect(PLAN_FACTS.pro.price).toBe(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
  });

  it("frames texting as fair use, not a hard message count (#85)", () => {
    // The plan card no longer quotes 500/2,500 — the exact figure lives in the
    // fair-use policy the billing page links to, and the usage screen shows
    // real usage. The included line carries no hard count.
    for (const plan of ["starter", "pro"] as const) {
      expect(PLAN_FACTS[plan].included.toLowerCase()).toContain("fair use");
      expect(PLAN_FACTS[plan].included).not.toMatch(/\d/);
    }
  });

  it("derives seats, numbers (pluralized), and overage from the constant", () => {
    expect(PLAN_FACTS.starter.seats).toBe(
      `${PLAN_PRICING.starter.seats} team members`,
    );
    expect(PLAN_FACTS.pro.seats).toBe(`${PLAN_PRICING.pro.seats} team members`);

    // Starter's single number is singular; Pro's pair is plural.
    expect(PLAN_FACTS.starter.numbers).toBe(
      `${PLAN_PRICING.starter.numbers} phone number`,
    );
    expect(PLAN_FACTS.pro.numbers).toBe(
      `${PLAN_PRICING.pro.numbers} phone numbers`,
    );

    expect(PLAN_FACTS.starter.overage).toBe(
      `${PLAN_PRICING.starter.overageCentsPerText}¢ per extra outgoing text`,
    );
    expect(PLAN_FACTS.pro.overage).toBe(
      `${PLAN_PRICING.pro.overageCentsPerText}¢ per extra outgoing text`,
    );
  });
});
