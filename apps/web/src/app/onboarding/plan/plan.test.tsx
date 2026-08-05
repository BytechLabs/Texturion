import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("frames texting as fair use, not a hard message count (#85)", () => {
    expect(starter.lines).toContain("Texting included, bound by fair use");
    expect(pro.lines).toContain("Texting included, bound by fair use");
  });

  it("derives the seat counts in each plan's crew line", () => {
    expect(starter.lines.join(" ")).toContain(
      `${PLAN_PRICING.starter.seats} teammates`,
    );
    expect(pro.lines.join(" ")).toContain(
      `${PLAN_PRICING.pro.seats} teammates`,
    );
  });

  it("derives the business-number count, pluralized", () => {
    expect(starter.lines).toContain(
      `${PLAN_PRICING.starter.numbers} business number`,
    );
    expect(pro.lines).toContain(`${PLAN_PRICING.pro.numbers} business numbers`);
  });

  it("keeps overage copy number-free (#121: rates live in the fair-use policy)", () => {
    for (const plan of PLANS) {
      expect(plan.lines).toContain(
        "Busy month? Extra texts bill under fair use, capped by you",
      );
      for (const line of plan.lines) {
        expect(line, line).not.toMatch(/¢/);
      }
    }
  });

  it("keeps customer-facing plan copy free of em-dashes (Law 6)", () => {
    for (const plan of PLANS) {
      for (const line of plan.lines) {
        expect(line, line).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("#522: one fee, one currency, on the screen before payment", () => {
  const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

  it("does not quote the registration fee from the USD-only mirror", () => {
    // `US_REGISTRATION_FEE_DOLLARS` is `US_REGISTRATION_FEE_CENTS.usd / 100` and
    // carries no currency. This page printed it while `WorkspaceSummary` above
    // it resolved the same fee through the country and printed the CAD figure,
    // so a Canadian reader saw two different prices for one charge, inches
    // apart, on the last screen before paying.
    expect(page).not.toContain("US_REGISTRATION_FEE_DOLLARS");
  });

  it("resolves the fee the same way the summary beside it does", () => {
    // Both now go through `currencyForCountry` and `formatMoney`. What the true
    // currency IS before a checkout exists is a separate question this screen
    // cannot answer — Stripe pins it at the first invoice — but it can refuse
    // to disagree with itself.
    const summary = readFileSync(join(__dirname, "workspace-summary.tsx"), "utf8");
    for (const source of [page, summary]) {
      expect(source).toContain("US_REGISTRATION_FEE_CENTS");
      expect(source).toContain("currencyForCountry");
    }
  });
});
