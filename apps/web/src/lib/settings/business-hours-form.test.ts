import { describe, expect, it } from "vitest";

import type { BusinessHours } from "@loonext/shared";

import {
  isDirty,
  summarizeDay,
  toBusinessHours,
  toFormState,
  WEEKDAY_ORDER,
} from "./business-hours-form";

describe("toFormState", () => {
  it("builds a Mon..Sun grid, open weekdays enabled with their times", () => {
    const hours: BusinessHours = {
      mon: { open: "08:00", close: "17:00" },
      sat: null,
    };
    const grid = toFormState(hours);
    expect(grid.map((d) => d.weekday)).toEqual(WEEKDAY_ORDER);
    const mon = grid.find((d) => d.weekday === "mon")!;
    expect(mon).toMatchObject({ enabled: true, open: "08:00", close: "17:00" });
    // Absent + null weekdays are closed.
    expect(grid.find((d) => d.weekday === "tue")!.enabled).toBe(false);
    expect(grid.find((d) => d.weekday === "sat")!.enabled).toBe(false);
  });

  it("gives a closed weekday sensible default times to edit into", () => {
    const grid = toFormState({});
    const wed = grid.find((d) => d.weekday === "wed")!;
    expect(wed.enabled).toBe(false);
    expect(wed.open).toBe("08:00");
    expect(wed.close).toBe("17:00");
  });
});

describe("toBusinessHours", () => {
  it("round-trips the enabled weekdays only (closed drop out of the map)", () => {
    const grid = toFormState({
      mon: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "15:00" },
    });
    expect(toBusinessHours(grid)).toEqual({
      mon: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "15:00" },
    });
  });

  it("is loss-free through form-state and back", () => {
    const hours: BusinessHours = {
      mon: { open: "08:00", close: "17:00" },
      tue: { open: "08:00", close: "17:00" },
    };
    expect(toBusinessHours(toFormState(hours))).toEqual(hours);
  });
});

describe("isDirty", () => {
  it("is false for identical grids and true when a day changes", () => {
    const base = toFormState({ mon: { open: "08:00", close: "17:00" } });
    expect(isDirty(base, toFormState({ mon: { open: "08:00", close: "17:00" } }))).toBe(
      false,
    );
    const changed = toFormState({ mon: { open: "07:00", close: "17:00" } });
    expect(isDirty(base, changed)).toBe(true);
  });

  it("ignores the (hidden) time of a disabled day", () => {
    const a = toFormState({}); // all closed with default times
    const b = a.map((d) => ({ ...d, open: "10:00" })); // times differ, still closed
    expect(isDirty(a, b)).toBe(false);
  });
});

describe("summarizeDay", () => {
  it("summarizes open and closed days", () => {
    expect(
      summarizeDay({ weekday: "mon", enabled: true, open: "08:00", close: "17:00" }),
    ).toBe("08:00 to 17:00");
    expect(
      summarizeDay({ weekday: "sun", enabled: false, open: "08:00", close: "17:00" }),
    ).toBe("Closed");
  });
});
