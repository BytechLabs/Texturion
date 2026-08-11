import {
  bothClocks,
  bothClocksSpoken,
  DEFAULT_LOCALE,
  type Locale as UiLocale,
} from "@loonext/shared";
import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isSameYear,
} from "date-fns";
import { frCA } from "date-fns/locale";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * The browser's IANA timezone (D15: captured silently at onboarding and sent
 * on POST /v1/companies). Undefined when the runtime reports nothing usable —
 * the caller omits the field and the server default applies.
 */
export function browserTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Absolute datetime with zone abbreviation for timestamp tooltips (D15):
 * "Jul 2, 2026, 2:14 PM EDT" in the viewer's browser timezone. `timeZone`
 * is a parameter only so tests can pin a zone; product code omits it.
 */
export function formatAbsoluteDateTime(
  iso: string,
  timeZone?: string,
): string {
  // Guard bad/absent input so a tooltip never shows "Invalid Date" or throws.
  const parsed = new Date(iso);
  if (!iso || Number.isNaN(parsed.getTime())) return "";
  // timeZoneName cannot combine with dateStyle/timeStyle — components only.
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(parsed);
}

/**
 * Relative timestamps for list rows (G4/G10): `2m`, `1h`, `Tue` under
 * 7 days; absolute (`Jun 12`, `Jun 12 2025`) after.
 *
 * ## #228: one word of copy, and a pile of names that are not copy
 *
 * `now` is the only sentence here and it comes from the catalogue. `m` and `h`
 * stay: they are the unit symbols, and a row this narrow reads the same in both
 * languages — a translated `2 min` would wrap the timestamp column.
 *
 * The WEEKDAY and MONTH names are data, not copy, so they go through date-fns's
 * own locale rather than into the catalogue — the same rule the catalogue
 * header states for dates and money. `frCA` is passed rather than the format
 * tokens being changed, so the English output is byte-for-byte what it was.
 */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
  t: Translate = makeTranslate(DEFAULT_LOCALE),
  locale: UiLocale = DEFAULT_LOCALE,
): string {
  const date = new Date(iso);
  // A bad/absent timestamp must render blank, not "NaNm" or a 1970 date.
  if (!iso || Number.isNaN(date.getTime())) return "";
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return t("misc.timeNow");
  if (minutes < 60) return `${minutes}m`;
  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h`;
  const options = locale === "fr-CA" ? { locale: frCA } : undefined;
  // Calendar days, not truncated 24h periods: a message from last <weekday>
  // exactly 7 calendar days back is ~6d10h → differenceInDays truncates to 6 →
  // would render today's weekday ("Mon" for both). Calendar-days gates it to
  // the absolute date instead, so the weekday window never repeats today's.
  const days = differenceInCalendarDays(now, date);
  if (days < 7) return format(date, "EEE", options);
  if (isSameYear(date, now)) return format(date, "MMM d", options);
  return format(date, "MMM d yyyy", options);
}

/**
 * #539 — a future instant, saying whose clock it is on.
 *
 * ## The bug this closes
 *
 * A queued message showed "Tue 8:00 AM", formatted in the CUSTOMER's zone
 * because that is the time whoever scheduled it picked. Nothing said so. A
 * dispatcher in Toronto reading a send queued for a customer in Vancouver saw
 * "8:00 AM", read their own clock, and was three hours out — with nothing on the
 * screen to argue with.
 *
 * One instant, two wall clocks, and the shared rule decides whether the second
 * one is worth saying: `bothClocks` stays quiet when the two read the same, so a
 * crew whose customers are all in town never sees the label at all.
 *
 * `destinationZone` is the zone the time was CHOSEN in — `clock_timezone` on a
 * scheduled row, the resolved destination clock on a picker.
 *
 * `readerZone` defaults to the browser's own, which is what every product call
 * site wants. It is a parameter rather than read ambiently so a test can state
 * both sides: a helper whose answer depends on the machine it runs on is a helper
 * that passes here and fails in CI.
 */
export function twoClockLabel(
  iso: string,
  destinationZone: string,
  readerZone?: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const here = wallClock(at, readerZone);
  return bothClocks(wallClock(at, destinationZone, here), here);
}

/** The same two facts as a sentence, for an accessible name. */
export function twoClockSpoken(
  iso: string,
  destinationZone: string,
  readerZone?: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const here = wallClock(at, readerZone);
  return bothClocksSpoken(wallClock(at, destinationZone, here), here);
}

/**
 * One instant as a wall clock, in a zone or in the reader's own.
 *
 * Weekday plus time, no date: everything this is used for is inside the
 * scheduling horizon, where "Tue 8:00 AM" is what somebody would say out loud and
 * a full date is noise.
 *
 * A zone the runtime rejects falls back to `ifUnknown` — which callers pass as the
 * READER'S already-rendered clock, so the two read the same and the rule reports
 * one time. Falling back to the machine's own zone instead was subtly worse: on a
 * server or a laptop set to neither party's zone it invented a third clock and then
 * announced the difference, which is a label about nothing. A stored zone is
 * column-constrained and API-validated, so this only fires if tzdata drops a zone
 * underneath a live value — and a quiet single time is the right failure there.
 */
function wallClock(at: Date, timeZone?: string, ifUnknown?: string): string {
  try {
    return at.toLocaleString(undefined, {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return (
      ifUnknown ??
      at.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }
}
