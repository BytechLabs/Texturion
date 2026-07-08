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

  it("derives the included texts, with the thousands separator", () => {
    expect(PLAN_FACTS.starter.included).toBe(
      "500 outgoing texts included each month",
    );
    expect(PLAN_FACTS.pro.included).toBe(
      "2,500 outgoing texts included each month",
    );
    expect(PLAN_FACTS.starter.included).toContain(
      PLAN_PRICING.starter.includedTexts.toLocaleString("en-US"),
    );
    expect(PLAN_FACTS.pro.included).toContain(
      PLAN_PRICING.pro.includedTexts.toLocaleString("en-US"),
    );
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
      `${PLAN_PRICING.starter.overageCentsPerText}¢ per extra text after that`,
    );
    expect(PLAN_FACTS.pro.overage).toBe(
      `${PLAN_PRICING.pro.overageCentsPerText}¢ per extra text after that`,
    );
  });
});
