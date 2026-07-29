/**
 * Company business-hours model + "is this instant after-hours" check
 * (FEATURE-GAPS Step 1 / after-hours away-reply).
 *
 * This is the SHOP's open-hours clock, interpreted in the COMPANY timezone
 * (companies.timezone, D15) — DISTINCT from the per-contact quiet-hours clock
 * (destinationLocalHour, D4) that gates cold outbound. Gating the away-reply on
 * the contact's destination-local hour would be the wrong clock (FEATURE-GAPS
 * §2), so this helper deliberately uses the company zone.
 *
 * Stored shape (companies.business_hours jsonb): a map of lowercase weekday
 * abbreviation -> { open: "HH:MM", close: "HH:MM" } in 24-hour company-local
 * time. A weekday ABSENT from the map (or null) means the shop is closed all
 * day (every inbound that day is after-hours). open === close, or an open/close
 * that fails to parse, also reads as closed all day. Overnight windows
 * (close < open, e.g. open 18:00 close 02:00) are supported.
 *
 * ---------------------------------------------------------------------------
 * #402: A WEEKLY LOOP CANNOT KNOW ABOUT CHRISTMAS.
 *
 * Christmas Day falls on a Thursday. The schedule says Thursday 08:00–17:00,
 * so at 10am on Christmas morning the product believed the shop was open — and
 * a homeowner with a burst pipe got SILENCE, because the away-reply only fires
 * outside the weekly window.
 *
 * An auto-reply matters MORE on a holiday than on an ordinary evening. At 9pm
 * on a Tuesday the customer knows why nobody replied and waits until morning.
 * On Christmas Day, silence is ambiguous — closed, or ignoring me? — and the
 * customer resolves that ambiguity by calling somebody else. Being closed is
 * not the problem. Being closed and silent is.
 *
 * ---------------------------------------------------------------------------
 * WHY OWNER-SET EXCEPTIONS AND NOT A HOLIDAY CALENDAR.
 *
 * A built-in calendar sounds like the obvious answer and is the wrong one. It
 * needs per-province and per-state data maintained forever, for a product
 * whose rule is lowest-possible-upkeep — and Canadian statutory holidays vary
 * BY PROVINCE, with Quebec observing St-Jean-Baptiste on 24 June, which is a
 * holiday nowhere else in the country.
 *
 * Worse, it would be wrong for the trades we sell to. Emergency plumbing and
 * HVAC are busiest exactly when everyone else is closed; a shop that works
 * Boxing Day would spend every year fighting a default that assumed otherwise.
 *
 * So the owner says which dates. Correct in every jurisdiction without
 * maintaining anything, and the same mechanism covers a funeral, a training
 * day, and the week the whole shop is away in August.
 */

export const WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** One weekday's open/close window in 24h "HH:MM" company-local time. */
export interface DayHours {
  open: string;
  close: string;
}

/** weekday -> window; a missing/absent weekday = closed all day. */
export type BusinessHours = Partial<Record<Weekday, DayHours | null>>;

/** "HH:MM" (00:00–23:59) → minutes since midnight, or null when malformed. */
export function parseHhmm(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** True when `value` is a well-formed BusinessHours map (validation helper). */
export function isValidBusinessHours(value: unknown): value is BusinessHours {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) return false;
    if (entry === null) continue;
    if (typeof entry !== "object" || Array.isArray(entry)) return false;
    const { open, close } = entry as Record<string, unknown>;
    if (typeof open !== "string" || typeof close !== "string") return false;
    if (parseHhmm(open) === null || parseHhmm(close) === null) return false;
  }
  return true;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timezone, fmt);
  }
  return fmt;
}

const WEEKDAY_FROM_LABEL: Record<string, Weekday> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

/** The company-local weekday + minutes-since-midnight at `atUtc`. */
export function companyLocalMoment(
  timezone: string,
  atUtc: Date,
): { weekday: Weekday; minutes: number } | null {
  if (Number.isNaN(atUtc.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = partsFormatter(timezone).formatToParts(atUtc);
  } catch {
    return null; // unknown IANA zone — caller treats as "cannot decide"
  }
  const label = parts.find((p) => p.type === "weekday")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (!label || hour === undefined || minute === undefined) return null;
  const weekday = WEEKDAY_FROM_LABEL[label];
  if (!weekday) return null;
  return { weekday, minutes: Number(hour) * 60 + Number(minute) };
}

const stampFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * An instant as a human-readable company-local stamp: "Wed 2026-07-15 12:00".
 *
 * Used to tell an AI prompt what "now" is, so relative words in a customer's
 * message ("tonight", "tomorrow", "Tuesday") resolve against the right clock.
 * Returns null for an unknown IANA zone, so callers can omit the line rather
 * than state a time they cannot place.
 */
export function formatZonedStamp(
  timezone: string,
  atUtc: Date,
): string | null {
  if (Number.isNaN(atUtc.getTime())) return null;
  let fmt = stampFormatters.get(timezone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        weekday: "short",
      });
    } catch {
      return null;
    }
    stampFormatters.set(timezone, fmt);
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt.formatToParts(atUtc);
  } catch {
    return null;
  }
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // Some ICU builds render midnight as 24 under hour12:false.
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}

/**
 * A date, or a run of dates, that overrides the weekly schedule (#402).
 *
 * A RANGE rather than a list of single dates, so the week a two-person shop
 * shuts in August is one entry the owner can read back and delete, not seven
 * they have to keep in step. A single day is `from === to`.
 */
export interface HoursException {
  /** Inclusive first date, company-local, "YYYY-MM-DD". */
  from: string;
  /** Inclusive last date. Equal to `from` for a single day. */
  to: string;
  /**
   * null = closed all day. Otherwise the window that REPLACES the weekday's —
   * a half-day on Christmas Eve is an exception with hours, not a closure.
   */
  hours: DayHours | null;
  /**
   * The owner's own words, for the away-reply to use. "Closed for the holiday,
   * back Monday" is a different message from "we're closed for the evening",
   * and only the owner knows which it is.
   */
  note?: string;
}

/** "YYYY-MM-DD" → the same string, or null when it is not a real date. */
function parseIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject a date the calendar does not have (31 February), which would
  // otherwise sit in the list looking like a closure that never fires — the
  // worst kind, because the owner believes they set it.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return trimmed;
}

/** True when `value` is a well-formed exception list (validation helper). */
export function isValidHoursExceptions(
  value: unknown,
): value is HoursException[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return false;
    const { from, to, hours, note } = entry as Record<string, unknown>;
    const start = parseIsoDate(from as string);
    const end = parseIsoDate(to as string);
    if (start === null || end === null) return false;
    // A backwards range would silently never match.
    if (end < start) return false;
    if (hours !== null && hours !== undefined) {
      if (typeof hours !== "object" || Array.isArray(hours)) return false;
      const { open, close } = hours as Record<string, unknown>;
      if (typeof open !== "string" || typeof close !== "string") return false;
      if (parseHhmm(open) === null || parseHhmm(close) === null) return false;
    }
    if (note !== undefined && typeof note !== "string") return false;
  }
  return true;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The company-local calendar date at `atUtc`, as "YYYY-MM-DD". */
export function companyLocalDate(
  timezone: string,
  atUtc: Date,
): string | null {
  if (Number.isNaN(atUtc.getTime())) return null;
  let fmt = dateFormatters.get(timezone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return null;
    }
    dateFormatters.set(timezone, fmt);
  }
  try {
    const parts = fmt.formatToParts(atUtc);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const out = `${get("year")}-${get("month")}-${get("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * The exception covering `date`, or null.
 *
 * THE MOST SPECIFIC ONE WINS — the shortest matching range. "Closed all week,
 * but open Saturday morning" is a natural thing to want, and it only works if
 * the single day beats the week regardless of the order they were entered in.
 * Ties fall to the earlier entry, so the answer never depends on sort
 * stability.
 */
export function exceptionFor(
  exceptions: readonly HoursException[] | null | undefined,
  date: string,
): HoursException | null {
  if (!Array.isArray(exceptions)) return null;
  let best: HoursException | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const entry of exceptions) {
    const from = parseIsoDate(entry?.from);
    const to = parseIsoDate(entry?.to);
    if (from === null || to === null || to < from) continue;
    if (date < from || date > to) continue;
    const span =
      Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
    if (span < bestSpan) {
      best = entry;
      bestSpan = span;
    }
  }
  return best;
}

/**
 * True when `atUtc`, rendered in the company `timezone`, falls OUTSIDE the
 * shop's open window for that weekday — i.e. the away-reply clock says
 * "we're not open right now."
 *
 * Returns true (after-hours) when the weekday is absent/closed, and false
 * (open) only when the current company-local minute is within [open, close).
 * Overnight windows (close <= open) wrap past midnight. An unparseable timezone
 * or malformed window is treated as after-hours = false is NOT assumed — an
 * unknown timezone returns true only if we truly cannot place the instant; to
 * avoid firing on bad config the caller also requires away_enabled + a message,
 * but here an unresolvable zone conservatively returns FALSE (do not auto-send
 * when we cannot compute the clock).
 */
export function isAfterHours(
  timezone: string,
  businessHours: BusinessHours,
  atUtc: Date,
  /** #402: dates that override the weekly loop. Absent = weekly only. */
  exceptions?: readonly HoursException[] | null,
): boolean {
  const moment = companyLocalMoment(timezone, atUtc);
  if (!moment) return false; // cannot place the instant → do not auto-send

  // #402: a date exception replaces the weekday entirely. Consulted FIRST,
  // because the whole point is that Christmas is not a working Thursday.
  const today = companyLocalDate(timezone, atUtc);
  const exception = today === null ? null : exceptionFor(exceptions, today);
  const day = exception ? exception.hours : businessHours[moment.weekday];
  if (!day) return true; // closed all day — by weekday or by exception

  const open = parseHhmm(day.open);
  const close = parseHhmm(day.close);
  if (open === null || close === null || open === close) {
    return true; // malformed or zero-length window → closed all day
  }

  const now = moment.minutes;
  if (close > open) {
    // Same-day window: open at [open, close).
    return !(now >= open && now < close);
  }
  // Overnight window (e.g. 18:00–02:00): open at [open, 24:00) ∪ [00:00, close).
  return !(now >= open || now < close);
}

/**
 * Why the shop is shut right now, so the away-reply can say the true thing
 * (#402 ask 2).
 *
 * "We're closed for the evening" and "we're closed for the holiday, back
 * Monday" are different messages, and sending the first one on Christmas
 * morning is its own small dishonesty. The away-reply already proves this
 * product can be candid about its own limits; this is what lets it be.
 *
 * Returns null when the shop is OPEN, so a caller can use it as the whole
 * decision rather than asking twice.
 */
export function closureReason(
  timezone: string,
  businessHours: BusinessHours,
  atUtc: Date,
  exceptions?: readonly HoursException[] | null,
): { kind: "weekly" | "exception"; note: string | null } | null {
  if (!isAfterHours(timezone, businessHours, atUtc, exceptions)) return null;
  const today = companyLocalDate(timezone, atUtc);
  const exception = today === null ? null : exceptionFor(exceptions, today);
  // An exception with HOURS that we are simply outside of is an ordinary
  // evening, not a closure: the shop opened today, it is just shut now. Only a
  // full-day closure earns the different message.
  if (exception && exception.hours === null) {
    return { kind: "exception", note: exception.note?.trim() || null };
  }
  return { kind: "weekly", note: null };
}
