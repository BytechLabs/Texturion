/**
 * #241 — the costed-comparison guards.
 *
 * Two jobs. First, the cross-check that makes the price table load-bearing
 * rather than decorative: `costs.ts` states a never-under-count posture, so a
 * modeled unit cost must never sit BELOW what the incumbent publicly charges.
 * If someone lowers a rate to make a projection look better, this fails.
 *
 * Second, staleness. External figures rot silently, so the recheck date is a
 * value a test can fail on (the `carrier-throughput.ts` pattern).
 */
import { describe, expect, it } from "vitest";

import {
  CARRIER_LIST_PRICES,
  CARRIER_PRICES_RECHECK_AFTER,
  CARRIER_PRICES_VERIFIED_ON,
  INCUMBENT_VENDOR,
  forwardedCallCentsPerMinute,
  listPrice,
  switchDeltaCentsPerSegment,
  switchDeltaCentsPerTenantMonth,
} from "./carrier-list-prices";
import { FIXED_MONTHLY_COST_CENTS, UNIT_COST_CENTS } from "./costs";
import { PLAN_INCLUDED_SEGMENTS } from "./plans";

describe("carrier list prices — freshness", () => {
  it("is still within its recheck window", () => {
    expect(
      new Date(CARRIER_PRICES_RECHECK_AFTER).getTime(),
      `Carrier list prices were verified on ${CARRIER_PRICES_VERIFIED_ON} and are due a re-read. ` +
        "Re-read each vendor's pricing page, update the figures WITH their source and date, " +
        "then move CARRIER_PRICES_RECHECK_AFTER forward. See docs/CARRIER-PORTABILITY.md §3.",
    ).toBeGreaterThan(Date.now());
  });

  it("records a source for every vendor, and never a zero for a gap", () => {
    for (const price of CARRIER_LIST_PRICES) {
      expect(price.source, `${price.vendor} has no source`).not.toBe("");
      // A missing figure must be null (an admitted gap), never 0 (a claim that
      // the vendor charges nothing).
      expect(price.baseOutboundUsd).toBeGreaterThan(0);
      for (const field of [
        price.baseInboundUsd,
        price.voiceInboundUsdPerMin,
        price.voiceOutboundUsdPerMin,
        price.numberMonthlyUsd,
      ]) {
        if (field !== null) expect(field).toBeGreaterThan(0);
      }
    }
  });
});

describe("the cost model never undercuts the incumbent's published floor", () => {
  const telnyx = listPrice(INCUMBENT_VENDOR);

  it("outbound segment", () => {
    expect(
      UNIT_COST_CENTS.outboundSegment,
      "modeled outbound segment cost is below Telnyx's published base rate — " +
        "costs.ts must never under-count (the carrier surcharge is on TOP of this)",
    ).toBeGreaterThanOrEqual(telnyx.baseOutboundUsd * 100);
  });

  it("inbound segment", () => {
    expect(telnyx.baseInboundUsd).not.toBeNull();
    expect(UNIT_COST_CENTS.inboundSegment).toBeGreaterThanOrEqual(
      (telnyx.baseInboundUsd as number) * 100,
    );
  });

  it("voice minute covers at least the published inbound leg", () => {
    expect(telnyx.voiceInboundUsdPerMin).not.toBeNull();
    expect(UNIT_COST_CENTS.voiceMinute).toBeGreaterThanOrEqual(
      (telnyx.voiceInboundUsdPerMin as number) * 100,
    );
  });

  it("per-number fixed cost matches the incumbent's published rental", () => {
    // $1.00 number + $0.10 SMS capability = the 110¢ in costs.ts. This one is
    // an equality: it is a rental we pay in full, not an estimate.
    expect(FIXED_MONTHLY_COST_CENTS.perNumber).toBe(
      Math.round((telnyx.numberMonthlyUsd as number) * 100),
    );
  });
});

describe("what a switch would cost", () => {
  it("Bandwidth is messaging-cost-neutral", () => {
    expect(switchDeltaCentsPerSegment("Bandwidth")).toBeCloseTo(0, 6);
    expect(
      switchDeltaCentsPerTenantMonth("Bandwidth", PLAN_INCLUDED_SEGMENTS.pro),
    ).toBeCloseTo(0, 6);
  });

  it("Twilio costs more per segment, and the delta scales with the plan", () => {
    const perSegment = switchDeltaCentsPerSegment("Twilio");
    expect(perSegment).toBeGreaterThan(0);
    // 0.83¢ − 0.40¢ = 0.43¢ per outbound segment.
    expect(perSegment).toBeCloseTo(0.43, 6);
    // On a fully-used Starter month that is $2.15 against $29 of revenue.
    expect(
      switchDeltaCentsPerTenantMonth("Twilio", PLAN_INCLUDED_SEGMENTS.starter),
    ).toBeCloseTo(215, 6);
    expect(
      switchDeltaCentsPerTenantMonth("Twilio", PLAN_INCLUDED_SEGMENTS.pro),
    ).toBeCloseTo(1075, 6);
  });

  it("prices a forwarded call at both legs, and admits an unpriceable one", () => {
    // Twilio: 0.85¢ inbound + 1.40¢ outbound.
    expect(forwardedCallCentsPerMinute("Twilio")).toBeCloseTo(2.25, 6);
    // Bandwidth: 0.55¢ + 1.00¢.
    expect(forwardedCallCentsPerMinute("Bandwidth")).toBeCloseTo(1.55, 6);
    // Telnyx publishes no US outbound leg — null, not a guess.
    expect(forwardedCallCentsPerMinute(INCUMBENT_VENDOR)).toBeNull();
  });

  it("both alternatives price voice above our modeled minute", () => {
    // Worth knowing before a voice migration is scoped: the model's 1.2¢/min
    // is an incumbent figure, and every published alternative exceeds it.
    for (const vendor of ["Bandwidth", "Twilio"]) {
      expect(
        forwardedCallCentsPerMinute(vendor) as number,
        `${vendor} forwarded-call cost no longer exceeds the model — recheck UNIT_COST_CENTS.voiceMinute`,
      ).toBeGreaterThan(UNIT_COST_CENTS.voiceMinute);
    }
  });

  it("refuses to invent a price for an unrecorded vendor", () => {
    expect(() => listPrice("Sinch")).toThrow(/no list price recorded/);
  });
});
