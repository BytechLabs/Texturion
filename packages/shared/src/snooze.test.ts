import { describe, expect, it } from "vitest";

import {
  daysUntilNextMonday,
  isSnoozeTargetValid,
  SNOOZE_MAX_DAYS,
  SNOOZE_MIN_LEAD_MS,
  snoozePresets,
  snoozeReturnShape,
} from "./snooze";

/**
 * #293 — the reference implementation of "later".
 *
 * Mirrored case for case by SnoozeLogicTest.kt and SnoozeLogicTests.swift. A
 * divergence here is one the crew meets as a thread coming back at the wrong
 * time on one device, which is worse than no snooze at all.
 *
 * Everything below constructs local Dates on purpose: the presets resolve in
 * the DEVICE's clock (#292), so a test written in UTC would be testing
 * something the product never does.
 */

/** 2026-08-05 is a Wednesday. */
function at(hour: number, minute = 0, day = 5): Date {
  return new Date(2026, 7, day, hour, minute, 0, 0);
}

describe("snoozePresets", () => {
  it("offers the whole ladder first thing in the morning", () => {
    const presets = snoozePresets(at(7));
    expect(presets.map((p) => p.id)).toEqual([
      "later_today",
      "this_evening",
      "tomorrow",
      "next_week",
    ]);
    expect(presets.map((p) => p.label)).toEqual([
      "This afternoon",
      "This evening",
      "Tomorrow morning",
      "Next week",
    ]);
  });

  it("resolves each preset to the right hour of the right day", () => {
    const byId = new Map(snoozePresets(at(7)).map((p) => [p.id, new Date(p.at)]));
    expect(byId.get("later_today")).toEqual(at(15));
    expect(byId.get("this_evening")).toEqual(at(18));
    expect(byId.get("tomorrow")).toEqual(at(8, 0, 6));
    // Wednesday the 5th → Monday the 10th.
    expect(byId.get("next_week")).toEqual(at(8, 0, 10));
  });

  it("drops a preset once it is behind us rather than greying it out", () => {
    // 4pm: there is no "this afternoon" left to offer.
    expect(snoozePresets(at(16)).map((p) => p.id)).toEqual([
      "this_evening",
      "tomorrow",
      "next_week",
    ]);
    // 7pm: the evening is gone too.
    expect(snoozePresets(at(19)).map((p) => p.id)).toEqual([
      "tomorrow",
      "next_week",
    ]);
  });

  it("drops a preset that is technically ahead but uselessly close", () => {
    // 14:55. "This afternoon" is five minutes away — the thread would blink
    // out and come straight back, which reads as a broken feature, not as a
    // badly chosen time.
    const ids = snoozePresets(at(14, 55)).map((p) => p.id);
    expect(ids).not.toContain("later_today");
    // …and the boundary is the lead time, not the hour: a minute earlier than
    // the floor and it is offered again.
    const justEnough = new Date(
      at(15).getTime() - SNOOZE_MIN_LEAD_MS - 60_000,
    );
    expect(snoozePresets(justEnough).map((p) => p.id)).toContain("later_today");
  });

  it("never returns a preset in the past, at any hour of any day", () => {
    for (let day = 1; day <= 14; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const now = at(hour, 30, day);
        for (const preset of snoozePresets(now)) {
          expect(preset.at).toBeGreaterThan(now.getTime());
        }
      }
    }
  });
});

describe("daysUntilNextMonday", () => {
  it("is next week's Monday, never today", () => {
    // Mon 2026-08-03 … Sun 2026-08-09.
    expect(daysUntilNextMonday(new Date(2026, 7, 3))).toBe(7); // Monday
    expect(daysUntilNextMonday(new Date(2026, 7, 5))).toBe(5); // Wednesday
    expect(daysUntilNextMonday(new Date(2026, 7, 8))).toBe(2); // Saturday
    expect(daysUntilNextMonday(new Date(2026, 7, 9))).toBe(1); // Sunday
  });
});

describe("isSnoozeTargetValid", () => {
  const now = at(9);

  it("refuses the past and the present", () => {
    expect(isSnoozeTargetValid(now.getTime() - 1, now)).toBe(false);
    expect(isSnoozeTargetValid(now.getTime(), now)).toBe(false);
    expect(isSnoozeTargetValid(now.getTime() + 1, now)).toBe(true);
  });

  it("refuses past the cap, matching the route's gate", () => {
    const cap = SNOOZE_MAX_DAYS * 86_400_000;
    expect(isSnoozeTargetValid(now.getTime() + cap, now)).toBe(true);
    expect(isSnoozeTargetValid(now.getTime() + cap + 1, now)).toBe(false);
  });

  it("refuses an unparseable date instead of sending NaN to the API", () => {
    expect(isSnoozeTargetValid(new Date("nonsense"), now)).toBe(false);
  });
});

describe("snoozeReturnShape", () => {
  it("counts day boundaries, not elapsed hours", () => {
    // 11pm to 1am is two hours and still "tomorrow"…
    expect(snoozeReturnShape(at(1, 0, 6), at(23, 0, 5))).toBe("tomorrow");
    // …and 1am to 11pm is twenty-two hours and still "today".
    expect(snoozeReturnShape(at(23, 0, 5), at(1, 0, 5))).toBe("today");
  });

  it("uses a weekday inside the week and a date beyond it", () => {
    expect(snoozeReturnShape(at(9, 0, 8), at(9, 0, 5))).toBe("weekday");
    expect(snoozeReturnShape(at(9, 0, 11), at(9, 0, 5))).toBe("weekday");
    // Seven days out, "Wednesday" could be either one — so it has to be a date.
    expect(snoozeReturnShape(at(9, 0, 12), at(9, 0, 5))).toBe("date");
  });

  it("treats an already-elapsed return as today, not as a negative date", () => {
    expect(snoozeReturnShape(at(9, 0, 1), at(9, 0, 5))).toBe("today");
  });
});
