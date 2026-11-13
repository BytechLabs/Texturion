/**
 * #720: the label every date is shown with, drawn from the shared rule.
 */
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { formatAbsoluteDateTime, formatTimestamp } from "./time";

const NOW = new Date("2026-11-10T20:00:00Z"); // 3:00 PM in Toronto
const en = makeTranslate("en");
const fr = makeTranslate("fr-CA");
const label = (iso: string, style: "short" | "long" = "short", t = en) =>
  formatTimestamp(iso, { style, now: NOW, t, timeZone: "America/Toronto" });

describe("#720 formatTimestamp", () => {
  it("TS-1: the last hour counts minutes, then today is the clock time", () => {
    expect(label("2026-11-10T19:59:40Z")).toBe("now");
    expect(label("2026-11-10T19:48:00Z")).toBe("12m");
    expect(label("2026-11-10T13:42:00Z")).toBe("8:42 AM");
  });

  it("TS-2: yesterday and tomorrow say so, with the time when there is room", () => {
    expect(label("2026-11-09T20:42:00Z")).toBe("Yesterday");
    expect(label("2026-11-09T20:42:00Z", "long")).toBe("Yesterday 3:42 PM");
    expect(label("2026-11-11T14:00:00Z", "long")).toBe("Tomorrow 9:00 AM");
  });

  it("TS-3: this week is the weekday, this year the date, older adds the year", () => {
    expect(label("2026-11-07T20:42:00Z")).toBe("Sat");
    expect(label("2026-11-07T20:42:00Z", "long")).toBe("Sat 3:42 PM");
    expect(label("2026-09-09T19:42:00Z")).toBe("Sep 9");
    expect(label("2026-09-09T19:42:00Z", "long")).toBe("Sep 9, 3:42 PM");
    expect(label("2025-09-09T19:42:00Z")).toBe("Sep 9, 2025");
  });

  it("TS-4: days are counted on the reader's clock", () => {
    // 11 PM last night in Toronto, 4 AM today in UTC.
    expect(label("2026-11-10T04:00:00Z")).toBe("Yesterday");
    expect(
      formatTimestamp("2026-11-10T04:00:00Z", { now: NOW, t: en, timeZone: "UTC" }),
    ).toBe("4:00 AM");
  });

  it("TS-5: French words come from the catalogue and the locale", () => {
    expect(label("2026-11-09T20:42:00Z", "short", fr)).toBe("Hier");
    expect(label("2026-11-10T19:59:40Z", "short", fr)).toBe("maintenant");
  });

  it("TS-6: a bad timestamp is blank", () => {
    expect(label("")).toBe("");
    expect(label("not a date")).toBe("");
  });

  it("TS-7: the exact time names the weekday and the zone", () => {
    expect(formatAbsoluteDateTime("2026-11-10T20:42:00Z", "America/Toronto", "en")).toBe(
      "Tue, Nov 10, 2026, 3:42 PM EST",
    );
  });
});
