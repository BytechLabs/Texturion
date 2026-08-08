import { describe, expect, it } from "vitest";

import { twoClockLabel, twoClockSpoken } from "./time";

/**
 * #539 — a scheduled time has to say whose clock it is on.
 *
 * Both zones are stated explicitly. The first version of this file stubbed `Intl`
 * to pin the reader's zone and every assertion was wrong by the machine's own
 * offset, because `toLocaleString` does not route through the constructor that was
 * stubbed. A helper whose answer depends on where it runs is one that passes on a
 * laptop and fails in CI.
 */
const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";
/** 8am in Vancouver, 11am in Toronto. */
const AT = "2026-08-11T15:00:00Z";

describe("twoClockLabel (#539)", () => {
  it("names both clocks when the reader is not where the customer is", () => {
    // THE BUG. The queued row said "8:00 AM" — the customer's clock, correctly —
    // and a Toronto dispatcher read it as their own eight o'clock.
    const line = twoClockLabel(AT, VANCOUVER, TORONTO);
    expect(line).toContain("8:00");
    expect(line).toContain("11:00");
    expect(line).toContain("their time");
    expect(line).toContain("yours");
  });

  it("says one plain time when the customer is in town", () => {
    // The ordinary day for most crews. A label that is noise on the ordinary day
    // is one people stop reading before the day it matters.
    const line = twoClockLabel(AT, TORONTO, TORONTO);
    expect(line).not.toContain("their time");
    expect(line).toContain("11:00");
  });

  it("stays quiet for two zone names that are one clock", () => {
    // Toronto and New York are the same clock face; labelling that difference
    // would put the line on every row for nothing anybody can see.
    expect(twoClockLabel(AT, "America/New_York", TORONTO)).not.toContain(
      "their time",
    );
  });

  it("is right on both sides of a DST boundary", () => {
    // Arizona keeps one offset all year while Toronto moves, so the gap is three
    // hours in January and two in July. Any stored offset would be wrong for half
    // the year.
    for (const iso of ["2026-01-15T17:00:00Z", "2026-07-15T17:00:00Z"]) {
      expect(twoClockLabel(iso, "America/Phoenix", TORONTO)).toContain(
        "their time",
      );
    }
  });

  it("carries the minutes of a half-hour zone", () => {
    // Newfoundland is UTC-3:30, where an hours-apart number is wrong every day
    // rather than twice a year.
    expect(twoClockLabel(AT, "America/St_Johns", TORONTO)).toContain(":30");
  });

  it("returns nothing for an unparseable stamp, so the caller can fall back", () => {
    expect(twoClockLabel("not a date", TORONTO, TORONTO)).toBe("");
    expect(twoClockSpoken("not a date", TORONTO, TORONTO)).toBe("");
  });

  it("falls back to the reader's clock for a zone the runtime rejects", () => {
    // A label is not worth an exception. The two then read the same, so the rule
    // reports one clock — a quiet failure rather than a crash in a list row.
    const line = twoClockLabel(AT, "Mars/Olympus_Mons", TORONTO);
    expect(line).toContain("11:00");
    expect(line).not.toContain("their time");
  });

  it("speaks the difference rather than punctuating it", () => {
    const spoken = twoClockSpoken(AT, VANCOUVER, TORONTO);
    expect(spoken).toContain("which is");
    expect(spoken).not.toContain("·");
  });
});
