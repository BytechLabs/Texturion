/**
 * #370 — the crew-size arithmetic, which is a public claim about somebody
 * else's prices.
 *
 * That makes it the kind of claim that gets expensive rather than merely wrong
 * when it rots, which is why `verification.ts` already dates the ledgers. These
 * pin the two properties that keep it defensible: every figure is DERIVED from
 * the verified per-seat rate, and no stated multiple is ever larger than the
 * truth.
 */
import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import {
  CREW_SIZES,
  competitorSeatsForCrew,
  crewComparison,
  loonextForCrew,
  type SeatPricing,
} from "./crew-scaling";

/** Heymarket, as the ledger states it. */
const HEYMARKET: SeatPricing = {
  name: "Heymarket",
  perUserDollars: 49,
  minimumSeats: 2,
};

describe("#370 loonextForCrew", () => {
  it("uses Starter up to its seat limit and Pro beyond", () => {
    expect(loonextForCrew(1)).toEqual({
      plan: "starter",
      dollars: PLAN_PRICING.starter.monthlyDollars,
    });
    expect(loonextForCrew(PLAN_PRICING.starter.seats)).toMatchObject({
      plan: "starter",
    });
    expect(loonextForCrew(PLAN_PRICING.starter.seats + 1)).toMatchObject({
      plan: "pro",
    });
  });

  it("reads our own prices from the one table, never a literal", () => {
    // Every price on a paying-customer surface traces to PLAN_PRICING. A
    // literal here would be the first exception, on the page most likely to be
    // read by somebody deciding whether to trust us.
    const ten = loonextForCrew(10);
    expect(ten.dollars).toBe(PLAN_PRICING.pro.monthlyDollars);
  });
});

describe("#370 competitorSeatsForCrew", () => {
  it("charges the seat minimum as a floor, not a discount", () => {
    // Heymarket's two-user minimum means a solo operator cannot buy their entry
    // price at all — which is completely invisible in a three-person comparison
    // and is exactly the kind of thing this section exists to show.
    expect(competitorSeatsForCrew(HEYMARKET, 1)).toBe(98);
    expect(competitorSeatsForCrew(HEYMARKET, 2)).toBe(98);
  });

  it("scales linearly above the minimum", () => {
    expect(competitorSeatsForCrew(HEYMARKET, 3)).toBe(147);
    expect(competitorSeatsForCrew(HEYMARKET, 10)).toBe(490);
  });
});

describe("#370 crewComparison", () => {
  const rows = crewComparison(HEYMARKET);

  it("covers the ends of the stated ICP and the plan change between them", () => {
    expect(rows.map((r) => r.people)).toEqual([...CREW_SIZES]);
  });

  it("shows the gap WIDENING, which is the whole claim", () => {
    // Not a fixed discount. If these ever stop increasing, the section is
    // making an argument the numbers no longer support.
    const multiples = rows.map((r) => r.multiple);
    expect(multiples[1]).toBeGreaterThan(multiples[0]);
    expect(multiples[2]).toBeGreaterThan(multiples[1]);
  });

  it("never states a multiple larger than the truth", () => {
    // Floored, not rounded. Overstating somebody else's price by a rounding
    // step is the error that turns a fair comparison into a correctable one.
    for (const row of rows) {
      expect(row.multiple).toBeLessThanOrEqual(
        row.competitorDollars / row.loonextDollars,
      );
    }
  });

  it("reproduces the figures #370 cites, from the rate alone", () => {
    // The issue quotes $29 vs a third of Heymarket at three, and $79 against
    // roughly $150-490 at ten. Derived here rather than typed, so re-verifying
    // their rate moves every one of these at once.
    expect(rows[1]).toMatchObject({ loonextDollars: 29, competitorDollars: 147 });
    expect(rows[2]).toMatchObject({ loonextDollars: 79, competitorDollars: 490 });
  });
});
