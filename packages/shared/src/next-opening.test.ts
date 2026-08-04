/**
 * #278 — when this shop is next open.
 *
 * NO-5 is the one that decides whether this is safe to speak down a phone
 * line. Every uncertainty returns null and the greeting then says nothing
 * about timing, because a caller told "back Monday at 8" who rings on Monday
 * at 8 and gets voicemail again has been lied to by a machine — and the only
 * person who ever finds out is the customer who left.
 */
import { describe, expect, it } from "vitest";

import { nextOpening, spokenTime } from "./next-opening";
import type { BusinessHours, HoursException } from "./business-hours";

const TZ = "America/Toronto";
const WEEKDAYS_9_TO_5: BusinessHours = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
};

/** A company-local instant, as UTC. Toronto is UTC-4 in July. */
function july(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 6, day, hour + 4, minute));
}

describe("#278 when we are next open", () => {
  it("NO-1: an evening call is told about tomorrow morning", () => {
    // Wednesday 15 July 2026, 9pm local — the case the feature exists for.
    const next = nextOpening(TZ, WEEKDAYS_9_TO_5, july(15, 21));
    expect(next?.label).toBe("tomorrow at 8am");
    expect(next?.daysAhead).toBe(1);
    expect(next?.date).toBe("2026-07-16");
  });

  it("NO-2: an early-morning call is told about later the same day", () => {
    // 6am Wednesday: the shop opens at 8, and "tomorrow" would be wrong by a
    // whole working day — which is exactly long enough to lose the job.
    const next = nextOpening(TZ, WEEKDAYS_9_TO_5, july(15, 6));
    expect(next?.label).toBe("later today at 8am");
    expect(next?.daysAhead).toBe(0);
  });

  it("NO-3: a Friday night call skips the weekend and names the day", () => {
    // Friday 17 July, 8pm. Saturday and Sunday are absent from the map, which
    // means closed — so the honest answer is Monday, not "tomorrow".
    const next = nextOpening(TZ, WEEKDAYS_9_TO_5, july(17, 20));
    expect(next?.label).toBe("Monday at 8am");
    expect(next?.daysAhead).toBe(3);
  });

  it("NO-4: a holiday closure moves the answer, because it moves the opening", () => {
    // THE #402 RULE, ON THE CALL SIDE. A weekly loop cannot know about a
    // holiday, and a greeting that promises tomorrow on the eve of a closure
    // is the same defect as the away-reply that used to stay silent on
    // Christmas morning — a confident wrong answer.
    const closed: HoursException[] = [
      { from: "2026-07-16", to: "2026-07-16", hours: null, note: "Closed" },
    ];
    const next = nextOpening(TZ, WEEKDAYS_9_TO_5, july(15, 21), closed);
    expect(next?.label).toBe("Friday at 8am");
    expect(next?.date).toBe("2026-07-17");
  });

  it("NO-4b: an exception with HOURS replaces the weekday's, and is announced", () => {
    // A half-day is an exception WITH hours, not a closure — the shop is open,
    // just differently, and the greeting has to say the real time.
    const halfDay: HoursException[] = [
      { from: "2026-07-16", to: "2026-07-16", hours: { open: "10:00", close: "13:00" } },
    ];
    const next = nextOpening(TZ, WEEKDAYS_9_TO_5, july(15, 21), halfDay);
    expect(next?.label).toBe("tomorrow at 10am");
  });

  it("NO-5: anything we cannot answer is null, never a guess", () => {
    // THE ONE THAT MATTERS. Each of these would otherwise become a promise on
    // a live call that nobody here would ever hear go wrong.
    // No hours configured at all — most workspaces, on day one.
    expect(nextOpening(TZ, null, july(15, 21))).toBeNull();
    expect(nextOpening(TZ, {}, july(15, 21))).toBeNull();
    // A timezone we cannot place: we do not know what "8am" would even mean.
    expect(nextOpening("Mars/Olympus", WEEKDAYS_9_TO_5, july(15, 21))).toBeNull();
    // A malformed window reads as closed here exactly as it does in
    // isAfterHours — a window we cannot parse must never become an opening we
    // announce.
    expect(nextOpening(TZ, { mon: { open: "8", close: "17:00" } }, july(15, 21))).toBeNull();
    // Zero-length, same rule.
    expect(
      nextOpening(TZ, { mon: { open: "08:00", close: "08:00" } }, july(15, 21)),
    ).toBeNull();
    // Shut for longer than the horizon: on holiday or out of business, and
    // either way not something to promise on their behalf.
    const shutForAMonth: HoursException[] = [
      { from: "2026-07-01", to: "2026-08-31", hours: null },
    ];
    expect(nextOpening(TZ, WEEKDAYS_9_TO_5, july(15, 21), shutForAMonth)).toBeNull();
  });

  it("NO-6: an overnight window is a real opening, at the hour it opens", () => {
    // An emergency line running 18:00–02:00. Asked at 3pm, the next opening is
    // 6pm today — not tomorrow, and not the 02:00 close.
    const overnight: BusinessHours = { wed: { open: "18:00", close: "02:00" } };
    const next = nextOpening(TZ, overnight, july(15, 15));
    expect(next?.label).toBe("later today at 6pm");
  });

  it("NO-7: the time is said the way a person says it", () => {
    expect(spokenTime(8 * 60)).toBe("8am");
    expect(spokenTime(12 * 60)).toBe("noon");
    expect(spokenTime(0)).toBe("midnight");
    expect(spokenTime(17 * 60 + 30)).toBe("5:30pm");
    expect(spokenTime(13 * 60)).toBe("1pm");
    expect(spokenTime(30)).toBe("12:30am");
  });
});
