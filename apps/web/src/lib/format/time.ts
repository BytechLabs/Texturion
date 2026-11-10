import {
  bothClocks,
  bothClocksSpoken,
  DEFAULT_LOCALE,
  timestampShape,
} from "@loonext/shared";

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

export type ZonedWallClockResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "invalid" | "nonexistent" | "ambiguous" };

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedWallClockParts(
  formatter: Intl.DateTimeFormat,
  instant: number,
): WallClockParts | null {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute].every(
    Number.isInteger,
  )
    ? (parts as unknown as WallClockParts)
    : null;
}

function sameWallClock(
  left: WallClockParts | null,
  right: WallClockParts,
): boolean {
  return Boolean(
    left &&
      left.year === right.year &&
      left.month === right.month &&
      left.day === right.day &&
      left.hour === right.hour &&
      left.minute === right.minute,
  );
}

/**
 * Convert a `datetime-local` wall clock in an explicit IANA zone to an instant.
 * DST gaps and repeated clocks are refused: choosing either side silently
 * would invent information the dispatcher never supplied.
 */
export function instantFromZonedWallClock(
  value: string,
  timeZone: string,
): ZonedWallClockResult {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !timeZone) return { ok: false, reason: "invalid" };
  const target: WallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const naive = new Date(0);
  naive.setUTCFullYear(target.year, target.month - 1, target.day);
  naive.setUTCHours(target.hour, target.minute, 0, 0);
  if (
    naive.getUTCFullYear() !== target.year ||
    naive.getUTCMonth() !== target.month - 1 ||
    naive.getUTCDate() !== target.day ||
    naive.getUTCHours() !== target.hour ||
    naive.getUTCMinutes() !== target.minute
  ) {
    return { ok: false, reason: "invalid" };
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }

  // Derive every offset in force around the requested day, then retain only
  // candidates that round-trip to the exact wall clock. Sampling both sides
  // of a transition captures half-hour DST zones as well as one-hour zones.
  const offsets = new Set<number>();
  for (let hours = -72; hours <= 72; hours += 6) {
    const sampledInstant = naive.getTime() + hours * 3_600_000;
    const sampledWall = zonedWallClockParts(formatter, sampledInstant);
    if (!sampledWall) return { ok: false, reason: "invalid" };
    const wallAsUtc = new Date(0);
    wallAsUtc.setUTCFullYear(
      sampledWall.year,
      sampledWall.month - 1,
      sampledWall.day,
    );
    wallAsUtc.setUTCHours(
      sampledWall.hour,
      sampledWall.minute,
      0,
      0,
    );
    offsets.add(wallAsUtc.getTime() - sampledInstant);
  }

  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive.getTime() - offset;
    if (sameWallClock(zonedWallClockParts(formatter, candidate), target)) {
      matches.add(candidate);
    }
  }
  if (matches.size === 0) return { ok: false, reason: "nonexistent" };
  if (matches.size > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, iso: new Date([...matches][0]!).toISOString() };
}

/**
 * Absolute datetime with zone abbreviation for timestamp tooltips (D15):
 * "Thu, Jul 2, 2026, 2:14 PM EDT" in the viewer's browser timezone.
 * `timeZone` is a parameter only so tests can pin a zone; product code omits
 * it.
 */
export function formatAbsoluteDateTime(
  iso: string,
  timeZone?: string,
  locale?: string,
): string {
  // Guard bad/absent input so a tooltip never shows "Invalid Date" or throws.
  const parsed = new Date(iso);
  if (!iso || Number.isNaN(parsed.getTime())) return "";
  // timeZoneName cannot combine with dateStyle/timeStyle — components only.
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
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
 * #720: how wide a timestamp may be. `short` fits a list column ("Sat",
 * "Sep 9"); `long` adds the time wherever the row has room ("Sat 3:42 PM",
 * "Sep 9, 3:42 PM").
 */
export type TimestampStyle = "short" | "long";

/**
 * #720: the label a date is shown with, from the shared rule
 * (`timestampShape`), in the reader's language and zone. A bad or absent
 * timestamp is blank, never "Invalid Date".
 */
export function formatTimestamp(
  iso: string,
  {
    style = "short",
    now = new Date(),
    t = makeTranslate(DEFAULT_LOCALE),
    timeZone,
  }: {
    style?: TimestampStyle;
    now?: Date;
    t?: Translate;
    /** Pinned by tests; product code reads the browser's own zone. */
    timeZone?: string;
  } = {},
): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return "";
  const zone = timeZone ?? browserTimezone() ?? "UTC";
  const draw = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(t.locale, { ...options, timeZone: zone }).format(at);
  const clock = () => draw({ hour: "numeric", minute: "2-digit" });
  const long = style === "long";

  const shape = timestampShape(at.getTime(), now.getTime(), zone);
  switch (shape.bucket) {
    case "now":
      return t("misc.timeNow");
    case "minutesAgo":
      return `${shape.minutes}m`;
    case "today":
      return clock();
    case "yesterday":
      return long
        ? t("misc.timeYesterdayAt", { time: clock() })
        : t("misc.timeYesterday");
    case "tomorrow":
      return long
        ? t("misc.timeTomorrowAt", { time: clock() })
        : t("misc.timeTomorrow");
    case "thisWeek":
      return long
        ? draw({ weekday: "short", hour: "numeric", minute: "2-digit" })
        : draw({ weekday: "short" });
    case "thisYear":
      return long
        ? draw({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : draw({ month: "short", day: "numeric" });
    case "older":
      return long
        ? draw({
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : draw({ year: "numeric", month: "short", day: "numeric" });
  }
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
  locale?: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const here = wallClock(at, readerZone, undefined, locale);
  return bothClocks(wallClock(at, destinationZone, here, locale), here);
}

/** The same two facts as a sentence, for an accessible name. */
export function twoClockSpoken(
  iso: string,
  destinationZone: string,
  readerZone?: string,
  locale?: string,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const here = wallClock(at, readerZone, undefined, locale);
  return bothClocksSpoken(wallClock(at, destinationZone, here, locale), here);
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
function wallClock(
  at: Date,
  timeZone?: string,
  ifUnknown?: string,
  locale?: string,
): string {
  try {
    return at.toLocaleString(locale, {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return (
      ifUnknown ??
      at.toLocaleString(locale, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }
}
