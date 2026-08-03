import { describe, expect, it } from "vitest";

import {
  SATISFACTION_ARC_MIN_DELTA,
  SATISFACTION_MIN_SAMPLE,
  formatSatisfaction,
  poorRatingLine,
  satisfactionArcDirection,
} from "./satisfaction";

describe("formatSatisfaction", () => {
  it("SF-1: renders an em dash rather than a zero nobody could score", () => {
    // 0.0 would be a score outside the 1–5 scale, i.e. the panel lying about a
    // workspace nobody has answered for.
    expect(formatSatisfaction(null)).toBe("—");
    expect(formatSatisfaction(undefined)).toBe("—");
    expect(formatSatisfaction(Number.NaN)).toBe("—");
  });

  it("SF-2: one decimal, because a second is noise on a 1-5 scale", () => {
    expect(formatSatisfaction(4.25)).toBe("4.3");
    expect(formatSatisfaction(5)).toBe("5.0");
  });
});

describe("satisfactionArcDirection", () => {
  it("SF-3: a move smaller than the threshold is not a direction", () => {
    expect(satisfactionArcDirection(0.1)).toBeNull();
    expect(satisfactionArcDirection(-0.1)).toBeNull();
    expect(satisfactionArcDirection(0)).toBeNull();
  });

  it("SF-4: names both directions, including the unflattering one", () => {
    expect(satisfactionArcDirection(SATISFACTION_ARC_MIN_DELTA)).toBe("better");
    expect(satisfactionArcDirection(-0.4)).toBe("worse");
  });

  it("SF-5: no baseline is 'we do not know', not 'no change'", () => {
    expect(satisfactionArcDirection(null)).toBeNull();
    expect(satisfactionArcDirection(undefined)).toBeNull();
  });
});

describe("poorRatingLine", () => {
  it("SF-6: counts as work to do, and gets the singular right", () => {
    expect(poorRatingLine(1)).toBe("1 job needed a call back");
    expect(poorRatingLine(3)).toBe("3 jobs needed a call back");
  });
});

describe("the sample floor", () => {
  it("SF-7: is high enough that one bad answer cannot swing a point", () => {
    // The floor's whole justification. With four answers a single 1 moves the
    // mean by more than a point; at the floor it must not. If somebody lowers
    // this constant, this is the argument they have to answer.
    const good = Array(SATISFACTION_MIN_SAMPLE - 1).fill(5);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const swing = mean(good) - mean([...good, 1]);
    expect(swing).toBeLessThan(1);
  });
});
