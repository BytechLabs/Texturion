/**
 * #351 — the carrier ceilings, and the guard that keeps them honest.
 *
 * These figures are EXTERNAL. The carriers set them, publish them, and change
 * them, and we hold a dated copy. A dated copy nobody re-checks is folklore
 * with a timestamp on it, so the staleness is a test failure rather than a
 * comment.
 */
import { describe, expect, it } from "vitest";

import {
  CARRIER_CEILING_WARN_FRACTION,
  TEN_DLC_CEILINGS,
  TEN_DLC_CEILINGS_RECHECK_AFTER,
  TEN_DLC_CEILINGS_VERIFIED_ON,
  approachingCarrierCeiling,
  dailyCeiling,
} from "./carrier-throughput";

describe("the ceilings themselves", () => {
  it("gives every tier a binding daily number and at least one carrier", () => {
    for (const [useCase, tier] of Object.entries(TEN_DLC_CEILINGS)) {
      expect(tier.useCase, useCase).toBe(useCase);
      expect(tier.carriers.length, useCase).toBeGreaterThan(0);
      expect(tier.bindingDailyMessages, useCase).toBeGreaterThan(0);
      expect(tier.label.length, useCase).toBeGreaterThan(3);
    }
  });

  it("makes the binding number the smallest daily cap any carrier publishes", () => {
    // The point of "binding" is that it is the one that bites first. If a
    // carrier with a lower daily cap is added and this is not updated, the
    // warning fires after the ceiling rather than before it — which is worse
    // than no warning, because it arrives with the failure it was meant to
    // pre-empt.
    for (const tier of Object.values(TEN_DLC_CEILINGS)) {
      const dailyCaps = tier.carriers
        .map((carrier) => carrier.perDay)
        .filter((cap): cap is number => cap !== null);
      expect(tier.bindingDailyMessages, tier.useCase).toBe(Math.min(...dailyCaps));
    }
  });

  it("keeps sole proprietor below low volume", () => {
    // A relationship rather than a value: if these ever invert, one of the two
    // figures was transcribed wrong.
    expect(dailyCeiling("SOLE_PROPRIETOR")).toBeLessThan(dailyCeiling("LOW_VOLUME"));
  });

  it("describes every carrier entry by day OR by rate, never neither", () => {
    // A row with both null says nothing at all and would silently contribute
    // nothing to the binding calculation.
    for (const tier of Object.values(TEN_DLC_CEILINGS)) {
      for (const carrier of tier.carriers) {
        expect(
          carrier.perDay !== null || carrier.perMinute !== null,
          `${tier.useCase}/${carrier.carrier}`,
        ).toBe(true);
        expect(carrier.note.length, carrier.carrier).toBeGreaterThan(20);
      }
    }
  });
});

describe("the staleness guard (#326's revisit trigger, as a failure)", () => {
  it("has not passed its re-check date", () => {
    // When this fails, the job is to re-read the carriers' published rules and
    // move BOTH dates — not to push the date forward. The figures being six
    // months old is the thing being reported.
    const recheck = new Date(TEN_DLC_CEILINGS_RECHECK_AFTER);
    expect(
      recheck.getTime(),
      `carrier ceilings were verified on ${TEN_DLC_CEILINGS_VERIFIED_ON} and are due a re-check`,
    ).toBeGreaterThan(Date.now());
  });

  it("re-checks within a year of verifying", () => {
    const verified = new Date(TEN_DLC_CEILINGS_VERIFIED_ON).getTime();
    const recheck = new Date(TEN_DLC_CEILINGS_RECHECK_AFTER).getTime();
    expect(recheck).toBeGreaterThan(verified);
    expect(recheck - verified).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });
});

describe("approaching the ceiling", () => {
  it("warns at 80%, the same fraction every other arm uses", () => {
    expect(CARRIER_CEILING_WARN_FRACTION).toBe(0.8);
    // 2,000/day on Low Volume Standard.
    expect(approachingCarrierCeiling(1_599, "LOW_VOLUME")).toBe(false);
    expect(approachingCarrierCeiling(1_600, "LOW_VOLUME")).toBe(true);
  });

  it("warns sooner for a sole proprietor, because their ceiling is lower", () => {
    // The same absolute volume is fine on one tier and nearly fatal on the
    // other. A warning keyed to a single number would be wrong for half our
    // tenants.
    expect(approachingCarrierCeiling(900, "LOW_VOLUME")).toBe(false);
    expect(approachingCarrierCeiling(900, "SOLE_PROPRIETOR")).toBe(true);
  });
});
