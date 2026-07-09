import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import { PLANS } from "./plans";

describe("onboarding plan cards trace to PLAN_PRICING (finding 7)", () => {
  const starter = PLANS.find((p) => p.id === "starter")!;
  const pro = PLANS.find((p) => p.id === "pro")!;

  it("derives each plan's price from the shared constant", () => {
    expect(starter.price).toBe(`$${PLAN_PRICING.starter.monthlyDollars}`);
    expect(pro.price).toBe(`$${PLAN_PRICING.pro.monthlyDollars}`);
  });

  it("derives the included texts with the thousands separator", () => {
    expect(starter.lines).toContain("500 outgoing texts included each month");
    expect(pro.lines).toContain("2,500 outgoing texts included each month");
  });

  it("derives the seat counts in each plan's crew line", () => {
    expect(starter.lines.join(" ")).toContain(
      `${PLAN_PRICING.starter.seats} teammates`,
    );
    // Pro's seats are null = unlimited (#83); the crew line says so in words.
    expect(PLAN_PRICING.pro.seats).toBeNull();
    expect(pro.lines.join(" ")).toContain("Unlimited teammates");
  });

  it("derives the business-number count, pluralized", () => {
    expect(starter.lines).toContain(
      `${PLAN_PRICING.starter.numbers} business number`,
    );
    expect(pro.lines).toContain(`${PLAN_PRICING.pro.numbers} business numbers`);
  });

  it("derives the per-text overage in each plan", () => {
    expect(starter.lines).toContain(
      `${PLAN_PRICING.starter.overageCentsPerText}¢ per extra outgoing text`,
    );
    expect(pro.lines).toContain(
      `${PLAN_PRICING.pro.overageCentsPerText}¢ per extra outgoing text`,
    );
  });

  it("keeps customer-facing plan copy free of em-dashes (Law 6)", () => {
    for (const plan of PLANS) {
      for (const line of plan.lines) {
        expect(line, line).not.toMatch(/[—–]/);
      }
    }
  });
});
