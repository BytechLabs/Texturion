import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatMoney, PLAN_PRICE_CENTS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";
import { PLAN_PRICING } from "@/lib/api/types";

import { planCards, PLANS } from "./plans";

describe("onboarding plan cards trace to PLAN_PRICING (finding 7)", () => {
  const starter = PLANS.find((p) => p.id === "starter")!;
  const pro = PLANS.find((p) => p.id === "pro")!;

  it("derives each plan's price from the shared constant", () => {
    expect(starter.price).toBe(`$${PLAN_PRICING.starter.monthlyDollars}`);
    expect(pro.price).toBe(`$${PLAN_PRICING.pro.monthlyDollars}`);
  });

  it("shows CAD monthly and daily prices in both languages", () => {
    const currencies = { starter: "cad", pro: "cad" } as const;
    for (const locale of ["en", "fr-CA"] as const) {
      for (const plan of planCards(makeTranslate(locale), currencies, "cad")) {
        const monthlyCents = PLAN_PRICE_CENTS.cad[plan.id];
        expect(plan.price).toBe(formatMoney(monthlyCents, "cad", "cad", locale));
        expect(plan.daily).toContain(formatMoney(Math.round(monthlyCents / 30), "cad", "cad", locale));
      }
    }
  });

  it("labels a plan billed in USD for a Canadian workspace", () => {
    const cards = planCards(undefined, { starter: "cad", pro: "usd" }, "cad");
    expect(cards.map(({ price }) => price)).toEqual([
      formatMoney(PLAN_PRICE_CENTS.cad.starter, "cad", "cad"),
      formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd", "cad"),
    ]);
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
  const page = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

  it("quotes and labels the same USD fee on the number and plan steps", () => {
    const summary = readFileSync(join(import.meta.dirname, "workspace-summary.tsx"), "utf8");
    const number = readFileSync(join(import.meta.dirname, "../number/page.tsx"), "utf8");
    for (const source of [page, summary, number]) {
      expect(source).toMatch(/formatMoney\(\s*US_REGISTRATION_FEE_CENTS\.usd,\s*"usd",/);
      expect(source).toContain("currencyForCountry");
    }
  });
});
