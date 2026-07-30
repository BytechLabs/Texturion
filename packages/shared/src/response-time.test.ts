/**
 * #239 — the response-time phrasing, and the table the Kotlin and Swift ports
 * must reproduce exactly (`ResponseTimeFormatTest.kt`,
 * `ResponseTimeFormatTests.swift` carry the same cases).
 */
import { describe, expect, it } from "vitest";

import {
  formatResponseTime,
  responseArcDirection,
} from "./response-time";

/** The shared table. Change it here and in both ports, or the parity test fails. */
export const CASES: [number, string][] = [
  [0, "0 sec"],
  [5, "5 sec"],
  [59, "59 sec"],
  [60, "1 min"],
  [90, "2 min"],
  [240, "4 min"],
  // The carry cases: these printed "60 min" and "23 hr 60 min" before it.
  [3599, "1 hr"],
  [3600, "1 hr"],
  [5400, "1 hr 30 min"],
  [10_800, "3 hr"],
  [86_399, "1 day"],
  [86_400, "1 day"],
  [172_800, "2 days"],
];

describe("formatResponseTime", () => {
  it("says the largest unit that still tells the truth", () => {
    for (const [seconds, expected] of CASES) {
      expect(formatResponseTime(seconds), String(seconds)).toBe(expected);
    }
  });

  it("refuses to invent a zero when there is no median", () => {
    // A window with no answered lead has no median. "0 sec" would read as
    // instant service for a workspace that answered nothing.
    expect(formatResponseTime(null)).toBe("—");
    expect(formatResponseTime(undefined)).toBe("—");
    expect(formatResponseTime(Number.NaN)).toBe("—");
  });

  it("keeps sub-minute precision, because that is the number worth repeating", () => {
    // "Under a minute" would round away the difference between a fifty-second
    // reply and a five-second one, and the five-second one is the sales pitch.
    expect(formatResponseTime(5)).toBe("5 sec");
    expect(formatResponseTime(50)).toBe("50 sec");
  });
});

describe("responseArcDirection", () => {
  it("draws no arc for a change under a minute", () => {
    // The same performance measured twice is not progress, and dressing it up as
    // progress is how a metric earns a reputation for flattery.
    for (const seconds of [0, 30, -30, 59, -59]) {
      expect(responseArcDirection(seconds), String(seconds)).toBeNull();
    }
  });

  it("names the direction honestly, including the wrong one", () => {
    expect(responseArcDirection(600)).toBe("faster");
    // A workspace that got slower is told so. A metric that only ever reports
    // improvement is one nobody believes.
    expect(responseArcDirection(-600)).toBe("slower");
  });

  it("has no arc without a baseline", () => {
    expect(responseArcDirection(null)).toBeNull();
    expect(responseArcDirection(undefined)).toBeNull();
  });
});
