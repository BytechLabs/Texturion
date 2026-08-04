/**
 * #278 — "we're closed" is not an answer. "We're back Monday at 8" is.
 *
 * The issue's last acceptance line is the one this file exists for: *"Every
 * greeting states what will actually happen next, including when."* A caller
 * who reaches a closed business and is told only that it is closed has to
 * decide, with no information, whether to wait or to ring somebody else — and
 * at 9pm on a Tuesday with a leak, they ring somebody else.
 *
 * The shop already told us when it opens. `business_hours` and its date
 * exceptions have been driving the away-reply since #402; nothing on the CALL
 * side has ever read them. So this needs no new setting, no new screen, and no
 * decision from the owner: every workspace that has ever filled in its hours
 * gets a greeting that says when, the first time somebody rings after close.
 *
 * WHY IT REFUSES RATHER THAN GUESSES. Every branch that cannot answer returns
 * null, and the greeting then says nothing about timing instead of saying
 * something wrong. A caller told "back Monday at 8" who rings on Monday at 8
 * and gets voicemail again has been lied to by a machine, which is worse than
 * having been told nothing — and the failure is invisible to us, because the
 * only person who finds out is the customer who left.
 *
 * The horizon is deliberately short (a fortnight). A shop closed longer than
 * that is on holiday or out of business, and either way "back on the 3rd of
 * next month" is not a promise this product should make on their behalf.
 */
import {
  companyLocalDate,
  companyLocalMoment,
  exceptionFor,
  parseHhmm,
  WEEKDAYS,
  type BusinessHours,
  type HoursException,
  type Weekday,
} from "./business-hours";

/** How far ahead we are willing to look. Past this we say nothing. */
const HORIZON_DAYS = 14;

/** Named the way a person says it, for the weekday phrase. */
const WEEKDAY_NAMES: Record<Weekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

export interface NextOpening {
  /** Company-local date, "YYYY-MM-DD". */
  date: string;
  /** Minutes since midnight, company-local. */
  minutes: number;
  /** How many company-local days ahead: 0 = today, 1 = tomorrow. */
  daysAhead: number;
  /** The whole thing as a person would say it: "Monday at 8am". */
  label: string;
}

/** "08:00" → "8am"; "12:00" → "noon"; "17:30" → "5:30pm". */
export function spokenTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  if (hour24 === 0 && minute === 0) return "midnight";
  if (hour24 === 12 && minute === 0) return "noon";
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

/** The weekday `offset` days after `date` ("YYYY-MM-DD"), or null. */
function weekdayAfter(date: string, offset: number): Weekday | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + offset * 86_400_000);
  return WEEKDAYS[shifted.getUTCDay()] ?? null;
}

/** That same date as "YYYY-MM-DD". */
function dateAfter(date: string, offset: number): string | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * When this shop next opens, or null when we cannot say.
 *
 * Null on: no hours configured, an unresolvable timezone, or nothing open
 * inside the horizon. Callers treat null as "say nothing about timing" — never
 * as "closed forever".
 *
 * Note this does NOT check whether the shop is open right now. It answers the
 * question it is named for, and the caller has usually already asked
 * `isAfterHours` to decide whether to ask this one at all.
 */
export function nextOpening(
  timezone: string,
  businessHours: BusinessHours | null | undefined,
  atUtc: Date,
  exceptions?: readonly HoursException[] | null,
): NextOpening | null {
  if (!businessHours || Object.keys(businessHours).length === 0) return null;
  const today = companyLocalDate(timezone, atUtc);
  const moment = companyLocalMoment(timezone, atUtc);
  if (today === null || moment === null) return null;

  for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
    const date = dateAfter(today, offset);
    const weekday = weekdayAfter(today, offset);
    if (date === null || weekday === null) return null;

    // A date exception REPLACES the weekday entirely — the same precedence
    // isAfterHours applies, because a greeting that disagrees with the clock
    // driving the call is worse than one that says nothing.
    const exception = exceptionFor(exceptions, date);
    const day = exception ? exception.hours : businessHours[weekday];
    if (!day) continue;

    const open = parseHhmm(day.open);
    const close = parseHhmm(day.close);
    // Malformed or zero-length reads as closed, matching isAfterHours. A
    // window we cannot parse must never become an opening we announce.
    if (open === null || close === null || open === close) continue;

    // Today only counts if the opening has not already passed. An overnight
    // window that started yesterday is not a future opening either — if it
    // were still running the shop would be open and nobody would be asking.
    if (offset === 0 && moment.minutes >= open) continue;

    return {
      date,
      minutes: open,
      daysAhead: offset,
      label: openingLabel(offset, weekday, open),
    };
  }
  return null;
}

/** "later today at 5pm" / "tomorrow at 8am" / "Monday at 8am". */
function openingLabel(daysAhead: number, weekday: Weekday, minutes: number): string {
  const time = `at ${spokenTime(minutes)}`;
  if (daysAhead === 0) return `later today ${time}`;
  if (daysAhead === 1) return `tomorrow ${time}`;
  // Beyond a week the weekday name stops being unambiguous — "Monday" a
  // fortnight out is a different Monday than the one anybody pictures — so it
  // says how far instead of naming a day it would be wrong about.
  if (daysAhead <= 6) return `${WEEKDAY_NAMES[weekday]} ${time}`;
  return `in ${daysAhead} days, ${time}`;
}
