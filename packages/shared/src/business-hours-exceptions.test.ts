/**
 * #402 — the shop is closed on Christmas and the weekly loop cannot know it.
 *
 * Christmas Day 2025 falls on a Thursday. The schedule says Thursday
 * 08:00–17:00, so at 10am the product believed the shop was open and a
 * homeowner with a burst pipe got silence — because the away-reply only fires
 * outside the weekly window, and by that model this was a working Thursday.
 */
import { describe, expect, it } from "vitest";

import {
  closureReason,
  companyLocalDate,
  exceptionFor,
  isAfterHours,
  isValidHoursExceptions,
  type BusinessHours,
  type HoursException,
} from "./business-hours";

const TZ = "America/Toronto";
/** Open every weekday 08:00–17:00, closed at weekends. */
const WEEKLY: BusinessHours = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
};

/** 2025-12-25 is a Thursday. 15:00Z is 10:00 in Toronto. */
const CHRISTMAS_MORNING = new Date("2025-12-25T15:00:00Z");
/** 2025-12-18, the Thursday a week earlier, same hour. */
const ORDINARY_THURSDAY = new Date("2025-12-18T15:00:00Z");

describe("#402 — a date exception beats the weekly loop", () => {
  it("believes the shop is open on Christmas without an exception", () => {
    // The bug, pinned so the fix cannot be mistaken for something that was
    // already working.
    expect(isAfterHours(TZ, WEEKLY, CHRISTMAS_MORNING)).toBe(false);
  });

  it("closes the shop on Christmas when the owner says so", () => {
    const closed: HoursException[] = [
      { from: "2025-12-25", to: "2025-12-25", hours: null, note: "Closed for the holiday" },
    ];
    expect(isAfterHours(TZ, WEEKLY, CHRISTMAS_MORNING, closed)).toBe(true);
    // …and the Thursday a week earlier is untouched.
    expect(isAfterHours(TZ, WEEKLY, ORDINARY_THURSDAY, closed)).toBe(false);
  });

  it("covers a whole week off with ONE entry", () => {
    // Ask 5. Seven separate dates would be seven things to keep in step.
    const august: HoursException[] = [
      { from: "2026-08-03", to: "2026-08-09", hours: null },
    ];
    const midweek = new Date("2026-08-05T15:00:00Z"); // Wednesday
    const after = new Date("2026-08-12T15:00:00Z"); // the next Wednesday
    expect(isAfterHours(TZ, WEEKLY, midweek, august)).toBe(true);
    expect(isAfterHours(TZ, WEEKLY, after, august)).toBe(false);
  });

  it("supports a half-day, not only a closure", () => {
    // Christmas Eve until noon. An exception with HOURS replaces the weekday's
    // window rather than shutting the day.
    const eve: HoursException[] = [
      { from: "2025-12-24", to: "2025-12-24", hours: { open: "08:00", close: "12:00" } },
    ];
    const tenAm = new Date("2025-12-24T15:00:00Z");
    const twoPm = new Date("2025-12-24T19:00:00Z");
    expect(isAfterHours(TZ, WEEKLY, tenAm, eve)).toBe(false);
    expect(isAfterHours(TZ, WEEKLY, twoPm, eve)).toBe(true);
  });

  it("lets the most specific exception win, whatever order it was entered", () => {
    // "Closed all week, but open Saturday morning" only works if the single
    // day beats the range regardless of position in the list.
    const both: HoursException[] = [
      { from: "2026-08-03", to: "2026-08-09", hours: null },
      { from: "2026-08-08", to: "2026-08-08", hours: { open: "09:00", close: "12:00" } },
    ];
    expect(exceptionFor(both, "2026-08-08")?.hours).toEqual({
      open: "09:00",
      close: "12:00",
    });
    // Reversed input, same answer.
    expect(exceptionFor([both[1], both[0]], "2026-08-08")?.hours).toEqual({
      open: "09:00",
      close: "12:00",
    });
    // A day inside the range with no override is still closed.
    expect(exceptionFor(both, "2026-08-05")?.hours).toBeNull();
  });

  it("resolves the date in the COMPANY zone, not UTC", () => {
    // 2025-12-26T02:00Z is still Christmas night in Toronto. Using the UTC
    // date would end the closure five hours early, on the evening the customer
    // is most likely to be texting about a broken furnace.
    const boxingDayUtc = new Date("2025-12-26T02:00:00Z");
    expect(companyLocalDate(TZ, boxingDayUtc)).toBe("2025-12-25");
    const closed: HoursException[] = [
      { from: "2025-12-25", to: "2025-12-25", hours: null },
    ];
    expect(isAfterHours(TZ, WEEKLY, boxingDayUtc, closed)).toBe(true);
  });
});

describe("#402 — telling the customer WHY, honestly", () => {
  it("says nothing at all while the shop is open", () => {
    expect(closureReason(TZ, WEEKLY, ORDINARY_THURSDAY)).toBeNull();
  });

  it("distinguishes a holiday from an ordinary evening", () => {
    // The whole of ask 2. "We're closed for the evening" on Christmas morning
    // is its own small dishonesty.
    const closed: HoursException[] = [
      { from: "2025-12-25", to: "2025-12-25", hours: null, note: "Back Monday" },
    ];
    expect(closureReason(TZ, WEEKLY, CHRISTMAS_MORNING, closed)).toEqual({
      kind: "exception",
      note: "Back Monday",
    });
    const evening = new Date("2025-12-18T23:00:00Z"); // 18:00 Toronto, Thursday
    expect(closureReason(TZ, WEEKLY, evening, closed)).toEqual({
      kind: "weekly",
      note: null,
    });
  });

  it("treats being outside a half-day as an ordinary evening", () => {
    // The shop DID open today; it is just shut now. Only a full-day closure
    // earns the different message.
    const eve: HoursException[] = [
      { from: "2025-12-24", to: "2025-12-24", hours: { open: "08:00", close: "12:00" } },
    ];
    expect(closureReason(TZ, WEEKLY, new Date("2025-12-24T19:00:00Z"), eve)).toEqual({
      kind: "weekly",
      note: null,
    });
  });
});

describe("#402 — validation refuses what would silently never fire", () => {
  it("accepts a well-formed list", () => {
    expect(
      isValidHoursExceptions([
        { from: "2025-12-25", to: "2025-12-25", hours: null },
        { from: "2026-08-03", to: "2026-08-09", hours: { open: "09:00", close: "12:00" } },
      ]),
    ).toBe(true);
    expect(isValidHoursExceptions([])).toBe(true);
  });

  it("rejects a backwards range", () => {
    // It would match nothing, so the owner would believe they set a closure
    // that never fires — the worst failure this feature can have.
    expect(
      isValidHoursExceptions([{ from: "2026-08-09", to: "2026-08-03", hours: null }]),
    ).toBe(false);
  });

  it("rejects a date the calendar does not have", () => {
    expect(
      isValidHoursExceptions([{ from: "2026-02-31", to: "2026-02-31", hours: null }]),
    ).toBe(false);
  });

  it("rejects a malformed window", () => {
    expect(
      isValidHoursExceptions([
        { from: "2026-08-03", to: "2026-08-03", hours: { open: "9am", close: "12:00" } },
      ]),
    ).toBe(false);
  });

  it("rejects anything that is not a list", () => {
    expect(isValidHoursExceptions(null)).toBe(false);
    expect(isValidHoursExceptions({ from: "2026-08-03" })).toBe(false);
  });
});
