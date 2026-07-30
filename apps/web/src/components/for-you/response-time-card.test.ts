/**
 * #239 — the copy the card puts in front of the owner.
 *
 * Every case here is one where the easy sentence would be a flattering one. The
 * issue is explicit that the first disagreement with the crew's gut ends the
 * metric's usefulness, and a panel that only ever congratulates is the fastest
 * way there.
 */
import { describe, expect, it } from "vitest";

import { arcSentence, noArcReason } from "./response-time-card";
import type { ResponseTimeReport } from "@/lib/api/reports";

function report(over: Partial<ResponseTimeReport>): ResponseTimeReport {
  return {
    window: { days: 30, since: "", until: "" },
    leads: 10,
    answered: 8,
    unanswered: 2,
    median_seconds: 240,
    p90_seconds: 3600,
    business_hours: { leads: 6, answered: 5, median_seconds: 180 },
    after_hours: { leads: 4, answered: 3, median_seconds: 900 },
    by_number: [],
    by_member: null,
    per_member_enabled: false,
    baseline: null,
    baseline_unavailable: null,
    improved_by_seconds: null,
    split_truncated: false,
    split_row_limit: 5000,
    ...over,
  };
}

describe("arcSentence", () => {
  it("leads with the improvement, in the words a contractor repeats", () => {
    const sentence = arcSentence(
      report({
        median_seconds: 240,
        improved_by_seconds: 10_560,
        baseline: {
          since: "",
          until: "",
          leads: 5,
          answered: 5,
          median_seconds: 10_800,
        },
      }),
    );
    expect(sentence).toBe("Down from 3 hr when you started");
  });

  it("says so when the workspace got SLOWER", () => {
    // A metric that only reports improvement is one nobody believes. This is the
    // sentence that keeps the other one credible.
    const sentence = arcSentence(
      report({
        median_seconds: 10_800,
        improved_by_seconds: -10_560,
        baseline: {
          since: "",
          until: "",
          leads: 5,
          answered: 5,
          median_seconds: 240,
        },
      }),
    );
    expect(sentence).toBe("Up from 4 min when you started");
  });

  it("draws no arc without a baseline, whatever the delta claims", () => {
    expect(arcSentence(report({ improved_by_seconds: 9999 }))).toBeNull();
  });

  it("draws no arc for a sub-minute change", () => {
    expect(
      arcSentence(
        report({
          improved_by_seconds: 30,
          baseline: {
            since: "",
            until: "",
            leads: 5,
            answered: 5,
            median_seconds: 270,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("noArcReason", () => {
  it("explains a young workspace instead of comparing it to itself", () => {
    expect(noArcReason(report({ baseline_unavailable: "too_new" }))).toContain(
      "fortnight",
    );
  });

  it("explains an empty first fortnight rather than claiming progress from zero", () => {
    expect(
      noArcReason(report({ baseline_unavailable: "no_answered_leads" })),
    ).toContain("nothing to compare");
  });

  it("says flat is flat", () => {
    expect(noArcReason(report({}))).toBe("About the same as when you started");
  });
});
