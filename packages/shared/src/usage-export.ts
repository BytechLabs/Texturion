/**
 * #595 — the bookkeeper's usage export, as the three clients all have to say it.
 *
 * The capability, the default period and the words were written once for the web
 * card (#304) and lived inside it. Two more clients now need the same surface, and
 * a rule that is about to be written three times belongs here before it is — not
 * after somebody notices the phones default to a different month.
 *
 * What is NOT here: the request itself. Each client has its own HTTP layer and its
 * own idea of a date input; what has to agree is the period offered by default and
 * the sentence explaining what the file is.
 */

/**
 * The last COMPLETE calendar month, as two `yyyy-mm-dd` days.
 *
 * Complete, not the current one: a bookkeeper reconciles a month that has
 * finished, and defaulting to a period still accruing produces a file that is out
 * of date before it finishes building.
 *
 * ---------------------------------------------------------------------------
 * TAKES YEAR AND MONTH, NOT A DATE, AND THAT IS THE PORTABLE PART.
 *
 * The web original did this with `new Date(firstOfThisMonth - 86_400_000)` — a
 * literal 24 hours off local midnight. It is right almost everywhere and wrong in
 * any zone whose clocks move at the month boundary, where subtracting 24 real
 * hours from midnight on the 1st lands at 23:00 on the day before the last day and
 * `getDate()` then reports it. More to the point here: Kotlin and Swift each have
 * their own calendar arithmetic, so a rule expressed in milliseconds is a rule
 * that has to be re-derived rather than translated.
 *
 * Integers in, strings out. Nothing about a time zone survives the boundary, so
 * all three clients can only agree — and `packages/shared/vectors` pins it.
 * ---------------------------------------------------------------------------
 *
 * @param year  the calendar year the caller is currently in
 * @param month the calendar month the caller is currently in, 1-12
 */
export function lastCompleteMonth(
  year: number,
  month: number,
): { from: string; to: string } {
  // December rolls back to the previous year. Written out rather than reached by
  // modulo, because the two lines below are what a reader checks first.
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return {
    from: `${pad4(prevYear)}-${pad2(prevMonth)}-01`,
    to: `${pad4(prevYear)}-${pad2(prevMonth)}-${pad2(daysInMonth(prevYear, prevMonth))}`,
  };
}

/**
 * Days in a month, by the Gregorian rule spelled out.
 *
 * A table plus three lines of leap year, rather than a date library, because this
 * is hand-ported to Kotlin and Swift and the ported copy has to be checkable by
 * reading it. The leap rule is the full one — 2100 is not a leap year, and a
 * `% 4` shortcut would be right for every year this product will plausibly run
 * and wrong in a way nobody would ever catch.
 */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

const pad2 = (value: number): string => `${value}`.padStart(2, "0");
const pad4 = (value: number): string => `${value}`.padStart(4, "0");

/**
 * The capability that decides whether this surface exists for somebody.
 *
 * `billing.manage`, and deliberately NOT `contacts.bulk`, which guards the
 * exports carrying customer data. This document names no customer, and gating it
 * the other way would lock out the bookkeeper — the person it is for. The API
 * agrees: `POST /v1/exports/usage` is `requireCapability("billing.manage")`.
 */
export const USAGE_EXPORT_CAPABILITY = "billing.manage" as const;

/** The words this surface owns, so the three clients cannot drift apart. */
export const EXPORT_USAGE_ACTION = "Export usage";
export const EXPORT_USAGE_BLURB =
  "Your texts, calls and storage for a period, as a file for whoever does " +
  "your books.";
export const EXPORT_USAGE_NOTE =
  "It counts what we measured — it is not a copy of your Stripe invoice, and " +
  "nothing on it is priced. It is put together in the background and appears " +
  "under Data export.";
