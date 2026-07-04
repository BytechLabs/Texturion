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
): boolean {
  const moment = companyLocalMoment(timezone, atUtc);
  if (!moment) return false; // cannot place the instant → do not auto-send

  const day = businessHours[moment.weekday];
  if (!day) return true; // weekday absent/closed → after-hours

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
