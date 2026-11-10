import type { Translate } from "@/i18n/provider";
import type {
  TaskLabel,
  TaskPriority,
  TaskRepeat,
} from "@/lib/api/types";

/**
 * #693: priority, labels and repeating tasks. Pure rules only (nothing here
 * draws), so the wire shapes and the sentences are testable on their own. The
 * wording and the rules mirror Android's TaskPlanning.kt and iOS.
 */

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Most pressing first, the order the pickers list them in. */
export const PRIORITY_PICKER: readonly TaskPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
  "none",
];

/** An unknown or missing value reads as the default, never as a crash. */
export function normalizePriority(value: string | null | undefined): TaskPriority {
  return PRIORITY_PICKER.find((p) => p === value) ?? "normal";
}

/** Only the two that ask for attention are drawn on a row, card or pin. */
export function isFlaggedPriority(value: string | null | undefined): boolean {
  return value === "high" || value === "urgent";
}

export const PRIORITY_LABEL_KEYS = {
  urgent: "tasks.priorityUrgent",
  high: "tasks.priorityHigh",
  normal: "tasks.priorityNormal",
  low: "tasks.priorityLow",
  none: "tasks.priorityNone",
} as const;

export function priorityLabelKey(value: string | null | undefined) {
  return PRIORITY_LABEL_KEYS[normalizePriority(value)];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * The chips a row or card has room for, and how many were left out ("+2").
 * Two fit beside a title without crowding it.
 */
export function capLabels(
  labels: readonly TaskLabel[] | null | undefined,
  max = 2,
): { shown: TaskLabel[]; more: number } {
  const all = labels ?? [];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// ---------------------------------------------------------------------------
// Scope: "this one" or "this and future"
// ---------------------------------------------------------------------------

export type TaskScope = "this" | "future";

/**
 * Whether to ask "this one / this and future". Only a repeat that is still
 * producing tasks has a future; a stopped one has none to carry an edit to.
 */
export function needsScopeChoice(
  repeat: Pick<TaskRepeat, "stopped"> | null | undefined,
): boolean {
  return repeat != null && !repeat.stopped;
}

/** The repeat icon on a row or card: a repeat that has not ended. */
export function showsRepeatIcon(
  repeat: Pick<TaskRepeat, "stopped"> | null | undefined,
): boolean {
  return repeat != null && !repeat.stopped;
}

// ---------------------------------------------------------------------------
// The repeat draft
// ---------------------------------------------------------------------------

export type RepeatKind = "schedule" | "after_done";
export type RepeatUnit = "day" | "week" | "month" | "year";
export type RepeatEndKind = "never" | "on" | "after";
export type MonthlyMode = "date" | "nth";

/** "After it's done" has no yearly form. */
export function allowedUnits(kind: RepeatKind): readonly RepeatUnit[] {
  return kind === "after_done"
    ? ["day", "week", "month"]
    : ["day", "week", "month", "year"];
}

/** The repeat dialog's working copy. */
export interface RepeatDraft {
  kind: RepeatKind;
  unit: RepeatUnit;
  every: number;
  /** ISO weekdays, 1 = Monday. */
  weekdays: number[];
  monthly: MonthlyMode;
  endKind: RepeatEndKind;
  /** YYYY-MM-DD. */
  endOn: string;
  endAfter: number;
  paused: boolean;
}

/** A job tied to a conversation or contact reads better as "after it's done". */
export function newRepeatDraft(linked: boolean): RepeatDraft {
  return {
    kind: linked ? "after_done" : "schedule",
    unit: linked ? "month" : "week",
    every: 1,
    weekdays: [],
    monthly: "date",
    endKind: "never",
    endOn: "",
    endAfter: 5,
    paused: false,
  };
}

export function draftFromRepeat(repeat: TaskRepeat): RepeatDraft {
  return {
    kind: repeat.kind,
    unit: repeat.unit,
    every: repeat.every,
    weekdays: [...(repeat.weekdays ?? [])].sort((a, b) => a - b),
    monthly: repeat.nth !== null ? "nth" : "date",
    endKind: repeat.ends.kind,
    endOn: repeat.ends.on ?? "",
    endAfter: repeat.ends.after ?? 5,
    paused: repeat.paused,
  };
}

/** The local calendar day a due value (ISO instant or datetime-local) falls on. */
export function dueDay(due: string | null | undefined): Date | null {
  if (!due) return null;
  const date = new Date(due);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 1..4, or -1 for the last, of this weekday in its month. */
export function nthOfMonth(date: Date): number {
  const nth = Math.floor((date.getDate() - 1) / 7) + 1;
  const week = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  const isLast = week.getMonth() !== date.getMonth();
  return isLast ? -1 : Math.min(nth, 4);
}

/** Monday = 1 .. Sunday = 7. */
export function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/**
 * Null when the draft can be saved, otherwise a catalogue key saying why not
 * (a schedule with no due date, an end date nobody picked).
 */
export function draftProblem(
  draft: RepeatDraft,
  due: string | null | undefined,
):
  | "tasks.repeatNeedsDue"
  | "tasks.repeatNoYearly"
  | "tasks.repeatEveryMin"
  | "tasks.repeatNeedsEndDate"
  | null {
  if (draft.kind === "schedule" && dueDay(due) === null) {
    return "tasks.repeatNeedsDue";
  }
  if (draft.kind === "after_done" && draft.unit === "year") {
    return "tasks.repeatNoYearly";
  }
  if (!Number.isInteger(draft.every) || draft.every < 1) {
    return "tasks.repeatEveryMin";
  }
  if (draft.endKind === "on" && draft.endOn === "") {
    return "tasks.repeatNeedsEndDate";
  }
  if (
    draft.endKind === "after" &&
    (!Number.isInteger(draft.endAfter) || draft.endAfter < 1)
  ) {
    return "tasks.repeatEveryMin";
  }
  return null;
}

/** The rule as POST /v1/tasks and PATCH /v1/tasks/:id take it. */
export interface RepeatRequest {
  kind: RepeatKind;
  unit: RepeatUnit;
  every: number;
  weekdays?: number[];
  month_day?: number;
  nth?: number;
  nth_weekday?: number;
  ends: { kind: RepeatEndKind; on?: string; after?: number };
  paused?: boolean;
}

/**
 * The wire rule for a draft. `due` anchors the weekday, day-of-month and
 * nth-weekday a bare choice means ("monthly" repeats on the due date's day).
 */
export function draftToRequest(
  draft: RepeatDraft,
  due: string | null | undefined,
): RepeatRequest {
  const anchor = dueDay(due);
  const schedule = draft.kind === "schedule";
  const body: RepeatRequest = {
    kind: draft.kind,
    unit: draft.unit,
    every: draft.every,
    ends: { kind: draft.endKind },
  };
  if (schedule && draft.unit === "week") {
    const days = [...draft.weekdays].sort((a, b) => a - b);
    if (days.length > 0) body.weekdays = days;
    else if (anchor) body.weekdays = [isoWeekday(anchor)];
  }
  if (schedule && draft.unit === "month" && anchor) {
    if (draft.monthly === "nth") {
      body.nth = nthOfMonth(anchor);
      body.nth_weekday = isoWeekday(anchor);
    } else {
      body.month_day = anchor.getDate();
    }
  }
  if (draft.endKind === "on") body.ends.on = draft.endOn;
  if (draft.endKind === "after") body.ends.after = draft.endAfter;
  if (draft.paused) body.paused = true;
  return body;
}

// ---------------------------------------------------------------------------
// The sentence
// ---------------------------------------------------------------------------

const UNIT_KEYS = {
  day: ["tasks.unitDay1", "tasks.unitDayN"],
  week: ["tasks.unitWeek1", "tasks.unitWeekN"],
  month: ["tasks.unitMonth1", "tasks.unitMonthN"],
  year: ["tasks.unitYear1", "tasks.unitYearN"],
} as const;

/** "day" / "days" in the reader's language. */
export function repeatUnitWord(unit: RepeatUnit, count: number, t: Translate) {
  return t(UNIT_KEYS[unit][count === 1 ? 0 : 1]);
}

/** A weekday's full name in the reader's language; 1 = Monday. */
export function weekdayName(isoDay: number, locale: string): string {
  const day = Math.min(7, Math.max(1, Math.trunc(isoDay)));
  // 2024-01-01 was a Monday.
  const date = new Date(Date.UTC(2024, 0, day));
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function ordinalWord(nth: number | null, t: Translate): string {
  switch (nth) {
    case 1:
      return t("tasks.nthFirst");
    case 2:
      return t("tasks.nthSecond");
    case 3:
      return t("tasks.nthThird");
    case 4:
      return t("tasks.nthFourth");
    default:
      return t("tasks.nthLast");
  }
}

/**
 * The one line a repeating task is described by: "Repeats every Monday",
 * "Repeats 6 months after it's done". Paused and ended repeats say so after it.
 */
export function repeatSummary(
  repeat: Pick<
    TaskRepeat,
    | "kind"
    | "unit"
    | "every"
    | "weekdays"
    | "month_day"
    | "nth"
    | "nth_weekday"
    | "ends"
    | "paused"
    | "stopped"
  >,
  t: Translate,
): string {
  const n = Math.max(1, repeat.every);
  const unit = repeat.unit;
  let base: string;
  if (repeat.kind === "after_done") {
    base = t("tasks.repeatAfterDone", {
      count: String(n),
      unit: repeatUnitWord(unit, n, t),
    });
  } else {
    const days = [...(repeat.weekdays ?? [])]
      .sort((a, b) => a - b)
      .map((d) => weekdayName(d, t.locale))
      .join(", ");
    if (unit === "week" && days !== "" && n === 1) {
      base = t("tasks.repeatWeekdays", { days });
    } else if (unit === "week" && days !== "") {
      base = t("tasks.repeatWeekdaysEvery", { count: String(n), days });
    } else if (unit === "month" && repeat.nth !== null && repeat.nth_weekday !== null) {
      base = t(n === 1 ? "tasks.repeatNthMonthly" : "tasks.repeatNthMonthlyEvery", {
        nth: ordinalWord(repeat.nth, t),
        day: weekdayName(repeat.nth_weekday, t.locale),
        count: String(n),
      });
    } else if (unit === "month" && repeat.month_day !== null) {
      base = t(n === 1 ? "tasks.repeatMonthDay" : "tasks.repeatMonthDayEvery", {
        date: String(repeat.month_day),
        count: String(n),
      });
    } else if (n === 1) {
      base = t("tasks.repeatEvery1", { unit: repeatUnitWord(unit, 1, t) });
    } else {
      base = t("tasks.repeatEveryN", {
        count: String(n),
        unit: repeatUnitWord(unit, n, t),
      });
    }
  }
  const tail: string[] = [];
  if (repeat.ends.kind === "on" && repeat.ends.on) {
    tail.push(t("tasks.repeatUntil", { date: repeat.ends.on }));
  } else if (repeat.ends.kind === "after" && repeat.ends.after !== null) {
    tail.push(t("tasks.repeatTimes", { count: String(repeat.ends.after) }));
  }
  if (repeat.stopped) tail.push(t("tasks.repeatEnded"));
  else if (repeat.paused) tail.push(t("tasks.repeatPausedTag"));
  return [base, ...tail].join(" · ");
}

/** The sentence for a draft that has not been saved yet. */
export function draftSummary(
  draft: RepeatDraft,
  due: string | null | undefined,
  t: Translate,
): string {
  const r = draftToRequest(draft, due);
  return repeatSummary(
    {
      kind: r.kind,
      unit: r.unit,
      every: r.every,
      weekdays: r.weekdays ?? null,
      month_day: r.month_day ?? null,
      nth: r.nth ?? null,
      nth_weekday: r.nth_weekday ?? null,
      ends: { kind: r.ends.kind, on: r.ends.on ?? null, after: r.ends.after ?? null },
      paused: r.paused ?? false,
      stopped: false,
    },
    t,
  );
}
