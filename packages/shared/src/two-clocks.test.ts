import { describe, expect, it } from "vitest";

import {
  bothClocks,
  bothClocksSpoken,
  CLOCK_CHOICE_DEFAULT,
  CLOCK_CHOICE_LABELS,
  instantForWallClock,
  sameClock,
  wallClockInZone,
} from "./two-clocks";

/** What each client will actually pass: an instant rendered in a zone. */
function wall(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

describe("two clocks (#539)", () => {
  it("says nothing extra when both clocks read the same", () => {
    // The common day for a crew whose customers are all in town. A label that is
    // noise on the common day is a label people stop reading before the day it
    // matters.
    const t = wall("2026-08-11T12:00:00Z", "America/Toronto");
    expect(bothClocks(t, t)).toBe(t);
    expect(bothClocks(t)).toBe(t);
    expect(bothClocks(t, null)).toBe(t);
  });

  it("names both when they differ", () => {
    // THE BUG. 8am in Vancouver is 11am in Toronto, and the queued row said
    // "8:00 AM" with nothing to argue with.
    const there = wall("2026-08-11T15:00:00Z", "America/Vancouver");
    const here = wall("2026-08-11T15:00:00Z", "America/Toronto");
    const line = bothClocks(there, here);
    expect(line).toContain("8:00 AM");
    expect(line).toContain("11:00 AM");
    expect(line).toContain("their time");
    expect(line).toContain("yours");
  });

  it("stays quiet for two zone NAMES that are one clock", () => {
    // Toronto and New York are the same clock face. Deciding by zone name would
    // put the label on every row of a workspace that texts across a state line
    // into the same hour.
    const there = wall("2026-08-11T15:00:00Z", "America/New_York");
    const here = wall("2026-08-11T15:00:00Z", "America/Toronto");
    expect(sameClock(there, here)).toBe(true);
    expect(bothClocks(there, here)).toBe(there);
  });

  it("is right across a DST boundary without any offset arithmetic", () => {
    // Arizona does not observe DST, so its gap with Toronto is 3 hours in
    // January and 2 in July. Comparing rendered clocks gets both right; an
    // offset stored anywhere would be wrong for half the year.
    const winter = "2026-01-15T17:00:00Z";
    const summer = "2026-07-15T17:00:00Z";
    for (const iso of [winter, summer]) {
      const there = wall(iso, "America/Phoenix");
      const here = wall(iso, "America/Toronto");
      expect(sameClock(there, here)).toBe(false);
      expect(bothClocks(there, here)).toContain("their time");
    }
    // And the gap really did change, which is what makes this test worth having:
    // Phoenix reads the same hour at the same instant in both seasons, while
    // Toronto moves an hour around it. Any stored offset between them would be
    // wrong for half the year.
    const hour = (s: string) => s.replace(/^\w+ /, "");
    expect(hour(wall(winter, "America/Phoenix"))).toBe(
      hour(wall(summer, "America/Phoenix")),
    );
    expect(hour(wall(winter, "America/Toronto"))).not.toBe(
      hour(wall(summer, "America/Toronto")),
    );
  });

  it("handles a half-hour zone, which is where offset maths usually breaks", () => {
    // Newfoundland is UTC-3:30. A label that only carried whole hours would say
    // the wrong minute every day of the year, not twice.
    const there = wall("2026-08-11T15:00:00Z", "America/St_Johns");
    const here = wall("2026-08-11T15:00:00Z", "America/Toronto");
    expect(bothClocks(there, here)).toContain(":30");
  });

  it("speaks the difference as a sentence, not as punctuation", () => {
    // A middot is announced as "middle dot" or skipped entirely, and neither is
    // a sentence.
    const there = wall("2026-08-11T15:00:00Z", "America/Vancouver");
    const here = wall("2026-08-11T15:00:00Z", "America/Toronto");
    expect(bothClocksSpoken(there, here)).toContain("which is");
    expect(bothClocksSpoken(there, here)).not.toContain("·");
    // And says nothing extra when there is nothing to say, like its twin.
    expect(bothClocksSpoken(there, there)).toBe(there);
  });

  it("ignores padding a formatter added on one side only", () => {
    expect(sameClock(" Tue 8:00 AM ", "Tue 8:00 AM")).toBe(true);
  });

  it("defaults a typed time to the reader's own clock", () => {
    // A native date-and-time field reads and writes the DEVICE's zone. Starting
    // on "theirs" would mean the value shown is not the value held, which is a
    // worse bug than the one the switch fixes.
    expect(CLOCK_CHOICE_DEFAULT).toBe("yours");
    expect(CLOCK_CHOICE_LABELS.yours).toBe("Your time");
    expect(CLOCK_CHOICE_LABELS.theirs).toBe("Their time");
  });
});

describe("instantForWallClock (#539's switch)", () => {
  /** What a zone's clock reads at an instant, for asserting the round trip. */
  function reads(at: Date, timeZone: string): string {
    return at.toLocaleString("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  it("finds the instant when the customer's clock reads what was typed", () => {
    // "8am their time" for a customer in Vancouver, from a sender anywhere.
    const at = instantForWallClock(
      { year: 2026, month: 8, day: 11, hour: 8, minute: 0 },
      "America/Vancouver",
    );
    expect(at).not.toBeNull();
    expect(at!.toISOString()).toBe("2026-08-11T15:00:00.000Z");
  });

  it("round-trips every whole hour of a day in a half-hour zone", () => {
    // Newfoundland is UTC-3:30 (UTC-2:30 in summer). An offset rounded to hours
    // would be wrong every single hour of every day here, not twice a year.
    for (let hour = 0; hour < 24; hour += 1) {
      const wall = { year: 2026, month: 8, day: 11, hour, minute: 45 };
      const at = instantForWallClock(wall, "America/St_Johns");
      expect(at, `hour ${hour}`).not.toBeNull();
      expect(wallClockInZone(at!, "America/St_Johns"), `hour ${hour}`).toEqual(wall);
    }
  });

  it("takes the FIRST of a repeated hour when the clocks go back", () => {
    // 1:30am happens twice on 2026-11-01 in Toronto. Returning the second would
    // send an hour later than the sender asked for, on a day nobody is thinking
    // about DST.
    const at = instantForWallClock(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
      "America/Toronto",
    );
    expect(at).not.toBeNull();
    // EDT is UTC-4, so the first 1:30 is 05:30Z; the second is 06:30Z.
    expect(at!.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("lands just past the gap when the typed time never happens", () => {
    // 2:30am does not exist on 2026-03-08 in Toronto — the clocks jump 2:00 to
    // 3:00. A send asked for then has to go at the first moment that did happen
    // rather than not at all.
    const at = instantForWallClock(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      "America/Toronto",
    );
    expect(at).not.toBeNull();
    const rendered = wallClockInZone(at!, "America/Toronto")!;
    // 3:30 EDT — the same wall-clock minute, on the far side of the hour that
    // was skipped. Never 1:30, which would be BEFORE what was asked for.
    expect(rendered.hour).toBe(3);
    expect(rendered.minute).toBe(30);
  });

  it("handles midnight, where an hour of 24 would move the day", () => {
    const wall = { year: 2026, month: 8, day: 11, hour: 0, minute: 0 };
    const at = instantForWallClock(wall, "America/Toronto");
    expect(wallClockInZone(at!, "America/Toronto")).toEqual(wall);
    expect(reads(at!, "America/Toronto")).toContain("08/11/2026");
  });

  it("returns null for a zone the runtime rejects", () => {
    // The caller then falls back to the reader's own clock rather than sending at
    // a guessed instant.
    expect(
      instantForWallClock(
        { year: 2026, month: 8, day: 11, hour: 8, minute: 0 },
        "Mars/Olympus_Mons",
      ),
    ).toBeNull();
    expect(wallClockInZone(new Date(), "Mars/Olympus_Mons")).toBeNull();
  });
});
