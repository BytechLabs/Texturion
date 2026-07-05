/**
 * Business-hours editor state <-> API shape (FEATURE-GAPS Step 1).
 *
 * The settings UI edits a per-weekday grid: each weekday is either OPEN (with an
 * open/close time) or CLOSED. The API stores a {@link BusinessHours} map where a
 * weekday present with { open, close } is open and an absent/null weekday is
 * closed. These pure helpers convert between the two so the page component stays
 * declarative and the conversion is unit-tested (mirroring the calm settings
 * house style of testable lib helpers).
 */
import { WEEKDAYS, type BusinessHours, type Weekday } from "@loonext/shared";

export { WEEKDAYS, type Weekday };

/** One weekday row in the editor grid. */
export interface DayFormState {
  weekday: Weekday;
  enabled: boolean;
  open: string;
  close: string;
}

/** Human weekday labels for the grid, in Mon..Sun order. */
export const WEEKDAY_ORDER: Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const DEFAULT_OPEN = "08:00";
const DEFAULT_CLOSE = "17:00";

/** Build the editor grid (Mon..Sun) from the stored BusinessHours map. */
export function toFormState(hours: BusinessHours): DayFormState[] {
  return WEEKDAY_ORDER.map((weekday) => {
    const day = hours[weekday];
    if (day && typeof day.open === "string" && typeof day.close === "string") {
      return { weekday, enabled: true, open: day.open, close: day.close };
    }
    return { weekday, enabled: false, open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  });
}

/** Convert the editor grid back to the API BusinessHours map. */
export function toBusinessHours(days: DayFormState[]): BusinessHours {
  const hours: BusinessHours = {};
  for (const day of days) {
    if (day.enabled) {
      hours[day.weekday] = { open: day.open, close: day.close };
    }
  }
  return hours;
}

/** True when two grids differ (drives the Save button's dirty state). */
export function isDirty(a: DayFormState[], b: DayFormState[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((day, i) => {
    const other = b[i];
    return (
      day.enabled !== other.enabled ||
      (day.enabled &&
        (day.open !== other.open || day.close !== other.close))
    );
  });
}

/** A short human summary of a day row for the read-only / preview line. */
export function summarizeDay(day: DayFormState): string {
  if (!day.enabled) return "Closed";
  return `${day.open} – ${day.close}`;
}

/** WEEKDAYS re-exported so callers don't reach into @loonext/shared directly. */
export { WEEKDAYS as ALL_WEEKDAYS };
