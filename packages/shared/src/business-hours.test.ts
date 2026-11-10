import { describe, expect, it } from "vitest";

import {
  companyLocalMoment,
  hasBusinessHours,
  isAfterHours,
  isValidBusinessHours,
  parseHhmm,
  type BusinessHours,
} from "./business-hours";

describe("parseHhmm", () => {
  it("parses valid HH:MM to minutes", () => {
    expect(parseHhmm("00:00")).toBe(0);
    expect(parseHhmm("08:30")).toBe(510);
    expect(parseHhmm("23:59")).toBe(1439);
  });

  it("rejects malformed values", () => {
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("08:60")).toBeNull();
    expect(parseHhmm("8:30")).toBeNull();
    expect(parseHhmm("")).toBeNull();
    expect(parseHhmm(null)).toBeNull();
    expect(parseHhmm("nope")).toBeNull();
  });
});

describe("isValidBusinessHours", () => {
  it("accepts an empty map and well-formed weekday windows", () => {
    expect(isValidBusinessHours({})).toBe(true);
    expect(
      isValidBusinessHours({
        mon: { open: "08:00", close: "17:00" },
        sat: null,
      }),
    ).toBe(true);
  });

  it("rejects unknown weekday keys and malformed windows", () => {
    expect(isValidBusinessHours({ funday: { open: "08:00", close: "17:00" } })).toBe(
      false,
    );
    expect(isValidBusinessHours({ mon: { open: "8", close: "17:00" } })).toBe(false);
    expect(isValidBusinessHours({ mon: { open: "08:00" } })).toBe(false);
    expect(isValidBusinessHours(null)).toBe(false);
    expect(isValidBusinessHours([])).toBe(false);
    expect(isValidBusinessHours("x")).toBe(false);
  });
});

describe("companyLocalMoment", () => {
  it("resolves weekday + minutes in the company zone", () => {
    // 2026-07-01 is a Wednesday. 16:00Z → 12:00 in America/Toronto (EDT).
    const m = companyLocalMoment(
      "America/Toronto",
      new Date("2026-07-01T16:00:00.000Z"),
    );
    expect(m).toEqual({ weekday: "wed", minutes: 12 * 60 });
  });

  it("returns null for an unknown timezone", () => {
    expect(
      companyLocalMoment("Not/AZone", new Date("2026-07-01T16:00:00.000Z")),
    ).toBeNull();
  });
});

describe("isAfterHours", () => {
  const hours: BusinessHours = {
    mon: { open: "08:00", close: "17:00" },
    tue: { open: "08:00", close: "17:00" },
    wed: { open: "08:00", close: "17:00" },
    thu: { open: "08:00", close: "17:00" },
    fri: { open: "08:00", close: "17:00" },
    // sat + sun absent → closed all day
  };

  it("is open during the window on an open weekday", () => {
    // Wed 12:00 Toronto = 16:00Z
    expect(
      isAfterHours("America/Toronto", hours, new Date("2026-07-01T16:00:00.000Z")),
    ).toBe(false);
  });

  it("is after-hours before open on an open weekday", () => {
    // Wed 07:00 Toronto = 11:00Z
    expect(
      isAfterHours("America/Toronto", hours, new Date("2026-07-01T11:00:00.000Z")),
    ).toBe(true);
  });

  it("is after-hours at/after close (close is exclusive)", () => {
    // Wed 17:00 Toronto = 21:00Z
    expect(
      isAfterHours("America/Toronto", hours, new Date("2026-07-01T21:00:00.000Z")),
    ).toBe(true);
  });

  it("is after-hours all day on an absent weekday (Saturday)", () => {
    // 2026-07-04 is a Saturday; midday Toronto is still after-hours.
    expect(
      isAfterHours("America/Toronto", hours, new Date("2026-07-04T16:00:00.000Z")),
    ).toBe(true);
  });

  it("treats a null weekday entry as closed all day", () => {
    expect(
      isAfterHours(
        "America/Toronto",
        { mon: { open: "08:00", close: "17:00" }, wed: null },
        new Date("2026-07-01T16:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("treats a zero-length or malformed window as closed", () => {
    expect(
      isAfterHours(
        "America/Toronto",
        { mon: { open: "08:00", close: "17:00" }, wed: { open: "09:00", close: "09:00" } },
        new Date("2026-07-01T16:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("supports overnight windows that wrap past midnight", () => {
    const overnight: BusinessHours = { wed: { open: "18:00", close: "02:00" } };
    // Wed 20:00 Toronto = Thu 00:00Z → inside the evening half.
    expect(
      isAfterHours("America/Toronto", overnight, new Date("2026-07-02T00:00:00.000Z")),
    ).toBe(false);
    // Wed 12:00 Toronto = 16:00Z → outside the overnight window.
    expect(
      isAfterHours("America/Toronto", overnight, new Date("2026-07-01T16:00:00.000Z")),
    ).toBe(true);
  });

  it("does not auto-fire when the timezone cannot be resolved", () => {
    expect(
      isAfterHours("Not/AZone", hours, new Date("2026-07-01T16:00:00.000Z")),
    ).toBe(false);
  });
});

describe("hasBusinessHours", () => {
  it("is false for unset hours (null, empty map, all-closed days)", () => {
    expect(hasBusinessHours(null)).toBe(false);
    expect(hasBusinessHours({})).toBe(false);
    expect(hasBusinessHours({ mon: null })).toBe(false);
  });

  it("is false for a zero-length or malformed window", () => {
    expect(hasBusinessHours({ mon: { open: "08:00", close: "08:00" } })).toBe(false);
    expect(hasBusinessHours({ mon: { open: "8", close: "17:00" } })).toBe(false);
  });

  it("is true once one real window is set", () => {
    expect(hasBusinessHours({ sat: { open: "09:00", close: "13:00" } })).toBe(true);
  });
});

// #721: `{}` is the column default and what the editor saves with every day
// unticked. Reading it as "closed all week" sent every inbound call to
// voicemail for a workspace that chose voicemail after hours but never set hours.
describe("isAfterHours with no hours set", () => {
  const wednesdayNoon = new Date("2026-07-01T16:00:00.000Z");
  const sundayMidnight = new Date("2026-07-05T04:00:00.000Z");

  it("is never after hours for an empty or all-closed schedule", () => {
    for (const unset of [{}, { mon: null, sun: null }] as BusinessHours[]) {
      expect(isAfterHours("America/Toronto", unset, wednesdayNoon)).toBe(false);
      expect(isAfterHours("America/Toronto", unset, sundayMidnight)).toBe(false);
    }
  });

  it("still closes on a date the owner marked closed", () => {
    const closedToday = [{ from: "2026-07-01", to: "2026-07-01", hours: null }];
    expect(isAfterHours("America/Toronto", {}, wednesdayNoon, closedToday)).toBe(true);
    expect(isAfterHours("America/Toronto", {}, sundayMidnight, closedToday)).toBe(false);
  });

  it("applies a special-hours date even with no weekly hours", () => {
    const shortDay = [
      { from: "2026-07-01", to: "2026-07-01", hours: { open: "08:00", close: "11:00" } },
    ];
    expect(isAfterHours("America/Toronto", {}, wednesdayNoon, shortDay)).toBe(true);
  });
});
