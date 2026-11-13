/**
 * #720: which words a date or time is shown in, on every client.
 *
 * The rule picks the bucket; each client draws the words in its own locale
 * ("3:42 PM", "Yesterday 3:42 PM", "Sat", "Sep 9", "Sep 9, 2025"). Calendar
 * days are counted in the reader's zone, so a text from 11 PM last night is
 * "yesterday" even when it was 4 hours ago.
 *
 * Future instants (a due time) use the same buckets, with "tomorrow" for the
 * day after today. Only the past gets "12m": a due time 12 minutes away reads
 * better as its clock time.
 */
export type TimestampBucket =
  | "now"
  | "minutesAgo"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "thisYear"
  | "older";

export interface TimestampShape {
  bucket: TimestampBucket;
  /** Whole minutes ago; set only for `minutesAgo`, 0 otherwise. */
  minutes: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface CalendarDay {
  year: number;
  day: number;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar day an instant falls on in a zone, as a day count and year. */
function calendarDay(ms: number, timeZone: string): CalendarDay {
  const parts = dayFormatter(timeZone).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = part("year");
  return { year, day: Date.UTC(year, part("month") - 1, part("day")) / DAY_MS };
}

let lastNow: { ms: number; timeZone: string; day: CalendarDay } | null = null;

/** A list draws its rows against the same `now`, so today is worked out once. */
function calendarDayOfNow(ms: number, timeZone: string): CalendarDay {
  if (lastNow?.ms !== ms || lastNow.timeZone !== timeZone) {
    lastNow = { ms, timeZone, day: calendarDay(ms, timeZone) };
  }
  return lastNow.day;
}

export function timestampShape(
  atMs: number,
  nowMs: number,
  timeZone: string,
): TimestampShape {
  const ago = nowMs - atMs;
  if (Math.abs(ago) < MINUTE_MS) return { bucket: "now", minutes: 0 };
  if (ago > 0 && ago < HOUR_MS) {
    return { bucket: "minutesAgo", minutes: Math.floor(ago / MINUTE_MS) };
  }
  const at = calendarDay(atMs, timeZone);
  const now = calendarDayOfNow(nowMs, timeZone);
  const daysAgo = now.day - at.day;
  if (daysAgo === 0) return { bucket: "today", minutes: 0 };
  if (daysAgo === 1) return { bucket: "yesterday", minutes: 0 };
  if (daysAgo === -1) return { bucket: "tomorrow", minutes: 0 };
  if (Math.abs(daysAgo) < 7) return { bucket: "thisWeek", minutes: 0 };
  if (at.year === now.year) return { bucket: "thisYear", minutes: 0 };
  return { bucket: "older", minutes: 0 };
}
