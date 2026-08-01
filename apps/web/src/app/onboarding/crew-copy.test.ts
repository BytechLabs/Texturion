/**
 * #370 — the line the signup says back once somebody picks a crew size.
 *
 * It quotes a price on a paying-customer surface and it makes a claim about
 * what the product fits, so both are pinned: derived from PLAN_PRICING rather
 * than typed, and silent about the segment we serve worse.
 */
import { CREW_SIZE_BUCKETS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import { CREW_FIT_PROMPT, crewFitCopy } from "./crew-copy";

describe("#370 crewFitCopy", () => {
  it("names Starter and its real price for the crews it covers", () => {
    for (const bucket of ["solo", "2_3"] as const) {
      const copy = crewFitCopy(bucket);
      expect(copy).toContain("Starter");
      expect(copy).toContain(`$${PLAN_PRICING.starter.monthlyDollars}`);
      expect(copy).toContain(String(PLAN_PRICING.starter.seats));
    }
  });

  it("moves to Pro where the per-seat comparison starts to bite", () => {
    const copy = crewFitCopy("4_10");
    expect(copy).toContain("Pro");
    expect(copy).toContain(`$${PLAN_PRICING.pro.monthlyDollars}`);
  });

  it("recommends NO plan past ten, and quotes no price", () => {
    // Pro's seat limit is 15, so a crew past ten is approaching a ceiling
    // rather than sitting inside a plan. #370 is explicit that we should not
    // market to a segment we serve worse, and a price here would do exactly
    // that.
    const copy = crewFitCopy("11_plus");
    expect(copy).not.toContain("$");
    expect(copy).not.toMatch(/\bStarter\b/);
    expect(copy).toContain(String(PLAN_PRICING.pro.seats));
  });

  it("says something for every bucket", () => {
    for (const bucket of CREW_SIZE_BUCKETS) {
      expect(crewFitCopy(bucket).length).toBeGreaterThan(0);
    }
  });

  it("renders no em or en dash anywhere (Law 6)", () => {
    const all = [CREW_FIT_PROMPT, ...CREW_SIZE_BUCKETS.map(crewFitCopy)];
    for (const line of all) {
      expect(line).not.toMatch(/[–—]/);
    }
  });

  it("tells the customer the question is optional", () => {
    // The column keeps "never asked" apart from "solo"; a signup that skips it
    // has to know skipping is allowed, or the distinction never appears.
    expect(CREW_FIT_PROMPT.toLowerCase()).toContain("skip");
  });
});
