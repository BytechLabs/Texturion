/**
 * @vitest-environment happy-dom
 */
/**
 * A list draws hundreds of timestamp labels, each needing one to five date
 * formatters. Each formatter is built once per locale, zone and options and
 * reused; the other tests in this directory pin the words.
 */
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import {
  browserTimezone,
  formatAbsoluteDateTime,
  formatCalendarDate,
  formatTimestamp,
  formatWallDay,
  formatWallHour,
  getFormatter,
  instantFromZonedWallClock,
  twoClockLabel,
  zonedWallClock,
} from "./time";

const TORONTO = "America/Toronto";
const VANCOUVER = "America/Vancouver";
const NOW = new Date("2026-11-10T20:00:00Z");
const en = makeTranslate("en");
const fr = makeTranslate("fr-CA");

/** Runs `body` with Intl.DateTimeFormat counted: built with `new`, and called bare. */
function counted<T>(
  body: () => T,
  bareResult?: () => Intl.DateTimeFormat,
): { value: T; built: number; bare: number } {
  const original = Intl.DateTimeFormat;
  let built = 0;
  let bare = 0;
  Intl.DateTimeFormat = new Proxy(original, {
    construct(target, args) {
      built += 1;
      return Reflect.construct(target, args);
    },
    apply(target, self, args) {
      bare += 1;
      return bareResult ? bareResult() : Reflect.apply(target, self, args);
    },
  });
  try {
    return { value: body(), built, bare };
  } finally {
    Intl.DateTimeFormat = original;
  }
}

const everyLabel = () => [
  formatTimestamp("2026-11-10T13:42:00Z", { now: NOW, t: en, timeZone: TORONTO }),
  formatTimestamp("2026-11-09T20:42:00Z", { style: "long", now: NOW, t: fr, timeZone: TORONTO }),
  formatTimestamp("2026-11-07T20:42:00Z", { style: "long", now: NOW, t: en, timeZone: TORONTO }),
  formatTimestamp("2026-09-09T19:42:00Z", { now: NOW, t: en, timeZone: TORONTO }),
  formatTimestamp("2025-09-09T19:42:00Z", { style: "long", now: NOW, t: en, timeZone: TORONTO }),
  formatTimestamp("2026-11-10T13:42:00Z", { now: NOW, t: en }),
  formatAbsoluteDateTime("2026-11-10T20:42:00Z", TORONTO, "en"),
  formatAbsoluteDateTime("2026-11-10T20:42:00Z", undefined, "fr-CA"),
  twoClockLabel("2026-08-11T15:00:00Z", VANCOUVER, TORONTO, "en"),
  twoClockLabel("2026-08-11T15:00:00Z", VANCOUVER, undefined, "en"),
  formatCalendarDate("2026-08-08T15:00:00Z", "en", TORONTO),
  formatCalendarDate("2026-08-08T15:00:00Z", "fr-CA"),
  formatWallDay("2026-11-12", "en"),
  formatWallHour(9, "fr-CA"),
  zonedWallClock("2026-11-10T20:42:00Z", TORONTO),
  instantFromZonedWallClock("2026-11-12T09:00", TORONTO),
];

describe("date formatters are built once", () => {
  it("FC-1: drawing the same labels again builds no formatter", () => {
    const first = everyLabel();
    const again = counted(everyLabel);
    expect(again.value).toEqual(first);
    expect(again.built).toBe(0);
  });

  it("FC-2: locale, zone and options each get their own formatter", () => {
    const at = new Date("2026-11-10T20:00:00Z");
    const clock = { hour: "numeric", minute: "2-digit" } as const;
    const toronto = getFormatter("en", TORONTO, clock);
    expect(getFormatter("en", TORONTO, { hour: "numeric", minute: "2-digit" })).toBe(toronto);
    expect(toronto.format(at)).toBe("3:00 PM");
    expect(getFormatter("en", VANCOUVER, clock).format(at)).toBe("12:00 PM");
    expect(getFormatter("fr-CA", TORONTO, clock).format(at)).toBe(
      new Intl.DateTimeFormat("fr-CA", { ...clock, timeZone: TORONTO }).format(at),
    );
    expect(getFormatter("fr-CA", TORONTO, clock)).not.toBe(toronto);
    expect(getFormatter("en", TORONTO, { hour: "numeric" }).format(at)).toBe("3 PM");
    expect(getFormatter("en", undefined, clock).resolvedOptions().timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it("FC-3: an unknown zone still throws, and is not kept", () => {
    expect(() => getFormatter("en", "Mars/Olympus", { hour: "numeric" })).toThrow(RangeError);
    expect(() => getFormatter("en", "Mars/Olympus", { hour: "numeric" })).toThrow(RangeError);
  });

  it("FC-4: the browser's zone is read once, and again when the tab is shown", () => {
    browserTimezone();
    const cached = counted(() => [browserTimezone(), browserTimezone()]);
    expect(cached.bare).toBe(0);

    document.dispatchEvent(new Event("visibilitychange"));
    const moved = counted(
      () => [browserTimezone(), browserTimezone()],
      () => ({ resolvedOptions: () => ({ timeZone: "America/Halifax" }) }) as Intl.DateTimeFormat,
    );
    expect(moved.value).toEqual(["America/Halifax", "America/Halifax"]);
    expect(moved.bare).toBe(1);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(browserTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
