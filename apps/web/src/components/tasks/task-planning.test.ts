import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/provider";
import type { TaskRepeat } from "@/lib/api/types";

import {
  capLabels,
  draftFromRepeat,
  draftProblem,
  draftToRequest,
  isFlaggedPriority,
  needsScopeChoice,
  newRepeatDraft,
  nthOfMonth,
  repeatSummary,
  showsRepeatIcon,
  type RepeatDraft,
} from "./task-planning";

const en = makeTranslate("en");
const fr = makeTranslate("fr-CA");

function repeat(over: Partial<TaskRepeat> = {}): TaskRepeat {
  return {
    id: "r1",
    kind: "schedule",
    unit: "week",
    every: 1,
    weekdays: null,
    month_day: null,
    nth: null,
    nth_weekday: null,
    ends: { kind: "never", on: null, after: null },
    paused: false,
    stopped: false,
    ...over,
  };
}

// 2026-11-09 is a Monday; local noon so any time zone keeps the same day.
const MONDAY = new Date(2026, 10, 9, 12, 0).toISOString();

describe("repeatSummary", () => {
  it("names the weekday", () => {
    expect(repeatSummary(repeat({ weekdays: [1] }), en)).toBe("Repeats every Monday");
  });

  it("lists several weekdays in order, and the interval when not weekly", () => {
    expect(repeatSummary(repeat({ weekdays: [5, 1] }), en)).toBe(
      "Repeats every Monday, Friday",
    );
    expect(repeatSummary(repeat({ weekdays: [1], every: 2 }), en)).toBe(
      "Repeats every 2 weeks on Monday",
    );
  });

  it("says after-done in units that agree with the count", () => {
    expect(
      repeatSummary(repeat({ kind: "after_done", unit: "month", every: 6 }), en),
    ).toBe("Repeats 6 months after it's done");
    expect(
      repeatSummary(repeat({ kind: "after_done", unit: "day", every: 1 }), en),
    ).toBe("Repeats 1 day after it's done");
  });

  it("describes a monthly date and an nth weekday", () => {
    expect(repeatSummary(repeat({ unit: "month", month_day: 15 }), en)).toBe(
      "Repeats on day 15 of every month",
    );
    expect(
      repeatSummary(repeat({ unit: "month", nth: -1, nth_weekday: 5 }), en),
    ).toBe("Repeats on the last Friday of every month");
  });

  it("falls back to a plain interval", () => {
    expect(repeatSummary(repeat({ unit: "day" }), en)).toBe("Repeats every day");
    expect(repeatSummary(repeat({ unit: "year", every: 2 }), en)).toBe(
      "Repeats every 2 years",
    );
  });

  it("appends the end rule, a pause and a finished repeat", () => {
    expect(
      repeatSummary(
        repeat({ unit: "day", ends: { kind: "after", on: null, after: 5 }, paused: true }),
        en,
      ),
    ).toBe("Repeats every day · 5 times · Paused");
    expect(
      repeatSummary(
        repeat({ unit: "day", ends: { kind: "on", on: "2027-01-01", after: null }, stopped: true }),
        en,
      ),
    ).toBe("Repeats every day · until 2027-01-01 · Repeat ended");
  });

  it("speaks French with French weekday names", () => {
    expect(repeatSummary(repeat({ weekdays: [1] }), fr)).toBe("Se répète chaque lundi");
  });
});

describe("repeat draft to request body", () => {
  const base = (over: Partial<RepeatDraft>): RepeatDraft => ({
    ...newRepeatDraft(false),
    ...over,
  });

  it("defaults a weekly schedule to the due date's weekday", () => {
    expect(draftToRequest(base({ unit: "week" }), MONDAY)).toEqual({
      kind: "schedule",
      unit: "week",
      every: 1,
      weekdays: [1],
      ends: { kind: "never" },
    });
  });

  it("sends the chosen weekdays sorted", () => {
    expect(
      draftToRequest(base({ unit: "week", weekdays: [5, 1, 3] }), MONDAY).weekdays,
    ).toEqual([1, 3, 5]);
  });

  it("anchors a monthly schedule to the date or to the nth weekday", () => {
    const date = draftToRequest(base({ unit: "month", monthly: "date" }), MONDAY);
    expect(date.month_day).toBe(9);
    expect(date.nth).toBeUndefined();
    const nth = draftToRequest(base({ unit: "month", monthly: "nth" }), MONDAY);
    expect(nth.nth).toBe(2);
    expect(nth.nth_weekday).toBe(1);
    expect(nth.month_day).toBeUndefined();
  });

  it("sends nothing calendar-shaped for an after-done repeat", () => {
    const body = draftToRequest(
      { ...newRepeatDraft(true), unit: "month", every: 6 },
      null,
    );
    expect(body).toEqual({
      kind: "after_done",
      unit: "month",
      every: 6,
      ends: { kind: "never" },
    });
  });

  it("carries the end rule and the pause", () => {
    expect(
      draftToRequest(
        base({ unit: "day", endKind: "on", endOn: "2027-02-01", paused: true }),
        MONDAY,
      ),
    ).toMatchObject({ ends: { kind: "on", on: "2027-02-01" }, paused: true });
    expect(
      draftToRequest(base({ unit: "day", endKind: "after", endAfter: 3 }), MONDAY).ends,
    ).toEqual({ kind: "after", after: 3 });
  });

  it("round-trips a saved rule through the draft", () => {
    const saved = repeat({ weekdays: [2, 4], every: 2, ends: { kind: "after", on: null, after: 8 } });
    expect(draftToRequest(draftFromRepeat(saved), MONDAY)).toMatchObject({
      unit: "week",
      every: 2,
      weekdays: [2, 4],
      ends: { kind: "after", after: 8 },
    });
  });

  it("picks the last weekday of the month as -1", () => {
    expect(nthOfMonth(new Date(2026, 10, 27))).toBe(-1);
    expect(nthOfMonth(new Date(2026, 10, 9))).toBe(2);
  });
});

describe("draftProblem", () => {
  it("needs a due date for a schedule but not after-done", () => {
    expect(draftProblem(newRepeatDraft(false), null)).toBe("tasks.repeatNeedsDue");
    expect(draftProblem(newRepeatDraft(false), MONDAY)).toBeNull();
    expect(draftProblem(newRepeatDraft(true), null)).toBeNull();
  });

  it("refuses yearly after-done, a zero interval and a missing end date", () => {
    expect(
      draftProblem({ ...newRepeatDraft(true), unit: "year" }, null),
    ).toBe("tasks.repeatNoYearly");
    expect(draftProblem({ ...newRepeatDraft(true), every: 0 }, null)).toBe(
      "tasks.repeatEveryMin",
    );
    expect(
      draftProblem({ ...newRepeatDraft(true), endKind: "on", endOn: "" }, null),
    ).toBe("tasks.repeatNeedsEndDate");
  });

  it("defaults the kind to after-done when linked to a contact or conversation", () => {
    expect(newRepeatDraft(true).kind).toBe("after_done");
    expect(newRepeatDraft(false).kind).toBe("schedule");
  });
});

describe("scope rule", () => {
  it("asks only while a repeat is still producing tasks", () => {
    expect(needsScopeChoice(null)).toBe(false);
    expect(needsScopeChoice(undefined)).toBe(false);
    expect(needsScopeChoice({ stopped: false })).toBe(true);
    expect(needsScopeChoice({ stopped: true })).toBe(false);
  });

  it("shows the repeat icon on the same terms", () => {
    expect(showsRepeatIcon(repeat())).toBe(true);
    expect(showsRepeatIcon(repeat({ stopped: true }))).toBe(false);
    expect(showsRepeatIcon(null)).toBe(false);
  });
});

describe("priority and label display", () => {
  it("flags only high and urgent", () => {
    expect(["urgent", "high", "normal", "low", "none", undefined].map(isFlaggedPriority)).toEqual(
      [true, true, false, false, false, false],
    );
  });

  it("caps label chips with a remainder", () => {
    const labels = ["a", "b", "c", "d"].map((id) => ({ id, name: id, color: null }));
    const capped = capLabels(labels);
    expect(capped.shown.map((l) => l.id)).toEqual(["a", "b"]);
    expect(capped.more).toBe(2);
    expect(capLabels(labels.slice(0, 2)).more).toBe(0);
    expect(capLabels(undefined)).toEqual({ shown: [], more: 0 });
  });
});
