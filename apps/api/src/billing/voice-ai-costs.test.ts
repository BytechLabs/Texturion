/**
 * #397 — the receptionist economics, pinned.
 *
 * The point of these assertions is that #397's asks 3 and 4 are a pricing and a
 * sequencing decision, and both were resting on an asserted cost range. These
 * pin the MEASURED numbers, so the decision can be made against them and a
 * later rate change surfaces as a failing test rather than a bad quarter.
 */
import { describe, expect, it } from "vitest";

import { PLAN_MONTHLY_REVENUE_CENTS, UNIT_COST_CENTS } from "./costs";
import {
  CATEGORY_PRICE_CENTS_PER_MONTH,
  PROPOSED_MODULE_PRICE_CENTS,
  REFERENCE_MINUTES_PER_MONTH,
  VOICE_AI_COST_CENTS_PER_MINUTE,
  VOICE_AI_PRICES_RECHECK_AFTER,
  VOICE_AI_PRICES_VERIFIED_ON,
  VOICE_AI_TOTAL_CENTS_PER_MINUTE,
  breakEvenMinutes,
  grossMarginFraction,
  referenceMonthlyCostCents,
} from "./voice-ai-costs";

describe("freshness", () => {
  it("is still within its recheck window", () => {
    expect(
      new Date(VOICE_AI_PRICES_RECHECK_AFTER).getTime(),
      `Voice-AI rates were read on ${VOICE_AI_PRICES_VERIFIED_ON} and are due a ` +
        "re-read. Update the figures WITH their source and date, then move " +
        "VOICE_AI_PRICES_RECHECK_AFTER forward.",
    ).toBeGreaterThan(Date.now());
  });

  it("uses our own measured voice minute, not the vendor's floor", () => {
    // Telnyx quotes inbound SIP from $0.0032/min. Using their floor while the
    // rest of the product meters voice at its measured cost would make this
    // model optimistic against our own numbers.
    expect(VOICE_AI_COST_CENTS_PER_MINUTE.telephony).toBe(
      UNIT_COST_CENTS.voiceMinute,
    );
  });
});

describe("what a receptionist minute costs", () => {
  it("is 6.8 cents all-in", () => {
    // 5.0 engine (orchestration + STT + TTS) + 0.6 LLM + 1.2 telephony.
    expect(VOICE_AI_TOTAL_CENTS_PER_MINUTE).toBeCloseTo(6.8, 6);
  });

  it("costs $13.60 for #397's reference contractor", () => {
    expect(REFERENCE_MINUTES_PER_MONTH).toBe(200);
    expect(referenceMonthlyCostCents()).toBeCloseTo(1360, 6);
  });

  it("corrects #397's premise while leaving its conclusion standing", () => {
    // #397: "$16–$30/mo in raw model cost … That equals or exceeds our entire
    // $29 plan revenue for one customer."
    const cost = referenceMonthlyCostCents();
    const starter = PLAN_MONTHLY_REVENUE_CENTS.starter;

    // The asserted floor was $16. Measured is below it.
    expect(cost).toBeLessThan(1600);
    // So it does NOT equal or exceed the plan — that half of the claim is wrong.
    expect(cost).toBeLessThan(starter);
    // But it is 47% of ARPU, which cannot be given away inside the plan. The
    // "must be a metered paid module" conclusion is unaffected and now measured.
    expect(cost / starter).toBeGreaterThan(0.4);
    expect(cost / starter).toBeLessThan(0.5);
  });
});

describe("the cap the cost-protection mandate needs", () => {
  it("names the minute at which a tenant eats the whole $29 plan", () => {
    // If this were ever bundled instead of metered, THIS is the number that
    // matters: past it, one tenant's receptionist costs more than they pay for
    // everything.
    expect(breakEvenMinutes(PLAN_MONTHLY_REVENUE_CENTS.starter)).toBe(426);
  });

  it("names break-even for the proposed module prices", () => {
    expect(breakEvenMinutes(PROPOSED_MODULE_PRICE_CENTS.low)).toBe(720);
    expect(breakEvenMinutes(PROPOSED_MODULE_PRICE_CENTS.high)).toBe(1_161);
  });

  it("returns zero rather than infinity for a free module", () => {
    // A guard, not a scenario: a $0 module has no minutes it can afford, and a
    // divide-by-zero here would read as "unlimited".
    expect(breakEvenMinutes(0)).toBe(0);
    expect(breakEvenMinutes(-100)).toBe(0);
  });

  it("turns the margin negative exactly past break-even", () => {
    const price = PROPOSED_MODULE_PRICE_CENTS.low;
    const cap = breakEvenMinutes(price);
    expect(grossMarginFraction(price, cap)).toBeGreaterThanOrEqual(0);
    expect(grossMarginFraction(price, cap + 5)).toBeLessThan(0);
  });
});

describe("the pricing decision (#397 ask 3)", () => {
  it("is a healthy module at the reference usage", () => {
    // 72% at $49, 82% at $79 — the numbers the price decision turns on.
    const low = grossMarginFraction(
      PROPOSED_MODULE_PRICE_CENTS.low,
      REFERENCE_MINUTES_PER_MONTH,
    );
    const high = grossMarginFraction(
      PROPOSED_MODULE_PRICE_CENTS.high,
      REFERENCE_MINUTES_PER_MONTH,
    );
    expect(low).toBeGreaterThan(0.7);
    expect(high).toBeGreaterThan(0.8);
  });

  it("stays well under the category's floor, which is ask 3's whole point", () => {
    // "Price it against the category, not against our plan." Even the top of
    // the proposed band undercuts the cheapest category offer substantially.
    expect(PROPOSED_MODULE_PRICE_CENTS.high).toBeLessThan(
      CATEGORY_PRICE_CENTS_PER_MONTH.low,
    );
    expect(
      CATEGORY_PRICE_CENTS_PER_MONTH.low / PROPOSED_MODULE_PRICE_CENTS.high,
    ).toBeGreaterThan(2);
  });

  it("shows why the $10 instinct ask 3 warns about would be the mistake", () => {
    // "Pricing it at $10 because it feels like a lot next to $29 would be the
    // expensive mistake." At $10 the module is under water at 148 minutes —
    // well inside the reference contractor's own 200.
    const tenDollars = 1_000;
    expect(breakEvenMinutes(tenDollars)).toBeLessThan(
      REFERENCE_MINUTES_PER_MONTH,
    );
    expect(
      grossMarginFraction(tenDollars, REFERENCE_MINUTES_PER_MONTH),
    ).toBeLessThan(0);
  });
});
