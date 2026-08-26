import { describe, expect, it } from "vitest";

import {
  resolveCalendarSync,
  sameCalendarSchedule,
  type CalendarScheduleSnapshot,
} from "./sync";

const BASE: CalendarScheduleSnapshot = {
  start: "2026-11-01T14:00:00.000Z",
  end: "2026-11-01T15:00:00.000Z",
  timeZone: "America/Toronto",
  title: "Furnace tune-up",
  descriptionHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function changed(
  patch: Partial<CalendarScheduleSnapshot>,
): CalendarScheduleSnapshot {
  return { ...BASE, ...patch };
}

describe("sameCalendarSchedule", () => {
  it("compares every scheduling field, including zone and description hash", () => {
    expect(sameCalendarSchedule(BASE, { ...BASE })).toBe(true);
    for (const candidate of [
      changed({ start: "2026-11-01T15:00:00.000Z" }),
      changed({ end: "2026-11-01T16:00:00.000Z" }),
      changed({ timeZone: "America/Edmonton" }),
      changed({ title: "Boiler tune-up" }),
      changed({
        descriptionHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ]) {
      expect(sameCalendarSchedule(BASE, candidate)).toBe(false);
    }
  });
});

describe("resolveCalendarSync", () => {
  it("pushes ours when only our scheduling fields changed", () => {
    const ours = changed({ start: "2026-11-01T17:00:00.000Z" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours,
        inbound: { kind: "scheduled", schedule: BASE },
      }),
    ).toEqual({
      kind: "push_ours",
      reason: "only_ours_changed",
      schedule: ours,
      requiresPrecondition: true,
    });
  });

  it("applies theirs and clears confirmation when only they changed", () => {
    const theirs = changed({ start: "2026-11-02T14:00:00.000Z" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "scheduled", schedule: theirs },
      }),
    ).toEqual({
      kind: "apply_theirs",
      schedule: theirs,
      clearConfirmation: true,
    });
  });

  it("raises a conflict when both sides moved differently", () => {
    const ours = changed({ start: "2026-11-02T14:00:00.000Z" });
    const theirs = changed({ start: "2026-11-03T14:00:00.000Z" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours,
        inbound: { kind: "scheduled", schedule: theirs },
      }),
    ).toEqual({
      kind: "conflict",
      reason: "both_changed",
      base: BASE,
      ours,
      theirs,
    });
  });

  it("accepts convergence when both sides independently reached the same values", () => {
    const agreed = changed({ title: "Furnace tune-up — Apt 3B" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: agreed,
        inbound: { kind: "scheduled", schedule: agreed },
      }),
    ).toEqual({ kind: "noop", reason: "already_equal", agreed });
  });

  it("recognizes an echo by sent field values rather than provider version", () => {
    const sent = changed({ start: "2026-11-02T14:00:00.000Z" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: sent,
        lastSent: sent,
        inbound: { kind: "scheduled", schedule: { ...sent } },
      }),
    ).toEqual({ kind: "noop", reason: "echo", agreed: sent });
  });

  it("never lets a late echo overwrite a newer local move", () => {
    const sent = changed({ start: "2026-11-02T14:00:00.000Z" });
    const latest = changed({ start: "2026-11-03T14:00:00.000Z" });
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: latest,
        lastSent: sent,
        inbound: { kind: "scheduled", schedule: sent },
      }),
    ).toEqual({
      kind: "push_ours",
      reason: "echo_superseded",
      schedule: latest,
      requiresPrecondition: true,
    });
  });

  it("does not guess a winner when a divergent pair has no common base", () => {
    const theirs = changed({ title: "Their title" });
    expect(
      resolveCalendarSync({
        base: null,
        ours: BASE,
        inbound: { kind: "scheduled", schedule: theirs },
      }),
    ).toMatchObject({ kind: "conflict", reason: "missing_base" });
  });

  it("can bootstrap a mapping whose two copies already agree", () => {
    expect(
      resolveCalendarSync({
        base: null,
        ours: BASE,
        inbound: { kind: "scheduled", schedule: { ...BASE } },
      }),
    ).toEqual({ kind: "noop", reason: "already_equal", agreed: BASE });
  });

  it("turns a provider deletion into a held question, never a task delete", () => {
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "removed" },
      }),
    ).toEqual({
      kind: "event_removed",
      keepTask: true,
      clearDueAt: true,
      remindersEligible: false,
    });
  });

  it("refuses all-day events instead of inventing an hour", () => {
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "all_day" },
      }),
    ).toEqual({
      kind: "all_day_refused",
      clearMirror: true,
      remindersEligible: false,
    });
  });

  it("refuses unknown provider zones instead of falling back to UTC", () => {
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "zone_refused", providerZone: "Mars Standard Time" },
      }),
    ).toEqual({
      kind: "zone_refused",
      providerZone: "Mars Standard Time",
      remindersEligible: false,
    });
  });

  it("refuses a provider title that cannot enter the canonical snapshot", () => {
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "title_refused", reason: "too_long" },
      }),
    ).toEqual({
      kind: "title_refused",
      reason: "too_long",
      remindersEligible: false,
    });
  });

  it("refuses malformed provider timing instead of poisoning the cursor", () => {
    expect(
      resolveCalendarSync({
        base: BASE,
        ours: BASE,
        inbound: { kind: "time_refused", reason: "invalid_range" },
      }),
    ).toEqual({
      kind: "time_refused",
      reason: "invalid_range",
      remindersEligible: false,
    });
  });
});
