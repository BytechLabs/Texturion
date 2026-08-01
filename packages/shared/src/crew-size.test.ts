/**
 * #370 — crew size, the variable that decides how strong our own pitch is.
 *
 * Every competitor bills per seat and we do not, so the advantage is not a
 * fixed discount: it widens with every person the customer hires. These pin the
 * two judgements that follow from that, both of which are about honesty rather
 * than arithmetic.
 */
import { describe, expect, it } from "vitest";

import {
  CREW_SIZE_BUCKETS,
  CREW_SIZE_LABELS,
  isBeyondSupportedCrew,
  isCrewSizeBucket,
  planFitForCrew,
} from "./crew-size";

describe("#370 crew-size buckets", () => {
  it("labels every bucket, in people rather than seats", () => {
    // "Seats" and "users" are licence words. A plumber has a crew.
    for (const bucket of CREW_SIZE_BUCKETS) {
      expect(CREW_SIZE_LABELS[bucket]).toBeTruthy();
      expect(CREW_SIZE_LABELS[bucket].toLowerCase()).not.toContain("seat");
      expect(CREW_SIZE_LABELS[bucket].toLowerCase()).not.toContain("user");
    }
  });

  it("recognises only the buckets", () => {
    expect(isCrewSizeBucket("solo")).toBe(true);
    expect(isCrewSizeBucket("4_10")).toBe(true);
    expect(isCrewSizeBucket("")).toBe(false);
    expect(isCrewSizeBucket("12")).toBe(false);
    expect(isCrewSizeBucket("SOLO")).toBe(false);
  });
});

describe("#370 planFitForCrew", () => {
  it("fits the two buckets Starter's three seats actually cover", () => {
    expect(planFitForCrew("solo")).toBe("starter");
    expect(planFitForCrew("2_3")).toBe("starter");
  });

  it("moves to Pro where the per-seat comparison starts to bite", () => {
    expect(planFitForCrew("4_10")).toBe("pro");
  });

  it("recommends NOTHING past ten, rather than recommending Pro", () => {
    // Pro's seat limit is 15, so a crew past ten is approaching a ceiling
    // rather than sitting comfortably inside a plan. Recommending Pro here
    // would sell somebody a plan they may outgrow during onboarding, and #370
    // is explicit that we should not market to a segment we serve worse.
    expect(planFitForCrew("11_plus")).toBeNull();
  });
});

describe("#370 isBeyondSupportedCrew", () => {
  it("flags the segment the product does not yet serve well", () => {
    // The ceiling is real: MAX_LEGS_PER_SESSION is 24, Pro seats stop at 15,
    // and #244's on-call routing does not exist — so ring-all across a large
    // crew is a worse experience rather than a better one. This flag is how a
    // funnel report can say how much pipeline sits in that segment BEFORE
    // anybody decides to chase it.
    expect(isBeyondSupportedCrew("11_plus")).toBe(true);
    for (const bucket of ["solo", "2_3", "4_10"] as const) {
      expect(isBeyondSupportedCrew(bucket)).toBe(false);
    }
  });
});
