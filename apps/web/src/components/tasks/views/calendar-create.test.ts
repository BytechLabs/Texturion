/**
 * #739: a click on the calendar prefills New task from WHERE it landed, in the
 * workspace's zone. Fixtures use Toronto and Los Angeles (Alberta dropped DST
 * in 2026, so it is a poor zone to pin anything on).
 */
import { describe, expect, it } from "vitest";

import { instantFromZonedWallClock } from "@/lib/format/time";

import {
  dayFromKey,
  dueCell,
  droppedDueAt,
  slotDueValue,
  todayInZone,
  windowInstants,
} from "./calendar-create";

describe("slotDueValue", () => {
  const day = dayFromKey("2026-11-12");
  it("month: the clicked day at the morning default", () => {
    expect(slotDueValue(day, null)).toBe("2026-11-12T09:00");
  });
  it("week: the clicked day and hour", () => {
    expect(slotDueValue(day, 14)).toBe("2026-11-12T14:00");
    expect(slotDueValue(day, 0)).toBe("2026-11-12T00:00");
  });
});

describe("workspace zone, not the device's", () => {
  it("a 9:00 Toronto slot is 14:00Z, whatever the device zone", () => {
    const due = slotDueValue(dayFromKey("2026-11-12"), 9);
    const r = instantFromZonedWallClock(due, "America/Toronto");
    expect(r).toEqual({ ok: true, iso: "2026-11-12T14:00:00.000Z" });
    const la = instantFromZonedWallClock(due, "America/Los_Angeles");
    expect(la).toEqual({ ok: true, iso: "2026-11-12T17:00:00.000Z" });
  });

  it("today is the workspace's date when the device is a day ahead or behind", () => {
    const now = new Date("2026-11-12T03:30:00Z"); // 22:30 on the 11th in Toronto, 19:30 in LA
    expect(todayInZone(now, "America/Toronto").getDate()).toBe(11);
    expect(todayInZone(now, "America/Los_Angeles").getDate()).toBe(11);
    expect(todayInZone(now, "UTC").getDate()).toBe(12);
  });

  it("a task lands in the cell its workspace clock says", () => {
    expect(dueCell("2026-11-12T03:30:00Z", "America/Toronto")).toEqual({
      key: "2026-11-11",
      hour: 22,
    });
    expect(dueCell("2026-11-12T03:30:00Z", "America/Los_Angeles")).toEqual({
      key: "2026-11-11",
      hour: 19,
    });
  });

  it("the fetched window starts at workspace midnight", () => {
    const w = windowInstants(dayFromKey("2026-11-08"), dayFromKey("2026-11-14"), "America/Toronto");
    expect(w.after).toBe("2026-11-08T05:00:00.000Z"); // the DST end day: still EDT at 00:00
    expect(w.before).toBe("2026-11-15T05:00:00.000Z");
  });
});

describe("droppedDueAt", () => {
  it("month: moves the date and keeps the workspace time of day", () => {
    // 09:30 Toronto on the 12th, dropped on the 13th.
    const next = droppedDueAt("2026-11-12T14:30:00Z", dayFromKey("2026-11-13"), null, "America/Toronto");
    expect(next).toBe("2026-11-13T14:30:00.000Z");
  });
  it("week: the slot names the hour, minutes stay", () => {
    const next = droppedDueAt("2026-11-12T14:30:00Z", dayFromKey("2026-11-12"), 15, "America/Toronto");
    expect(next).toBe("2026-11-12T20:30:00.000Z");
  });
  it("does nothing when the task would not move", () => {
    expect(
      droppedDueAt("2026-11-12T14:30:00Z", dayFromKey("2026-11-12"), null, "America/Toronto"),
    ).toBeNull();
  });
});
