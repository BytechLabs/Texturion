import type { CalendarScheduleSnapshot } from "../sync";

const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function parseWallClock(value: string): WallClockParts | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const parts: WallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number((match[7] ?? "").padEnd(3, "0").slice(0, 3)),
  };
  const validation = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  if (
    validation.getUTCFullYear() !== parts.year ||
    validation.getUTCMonth() + 1 !== parts.month ||
    validation.getUTCDate() !== parts.day ||
    validation.getUTCHours() !== parts.hour ||
    validation.getUTCMinutes() !== parts.minute ||
    validation.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

function partsAt(instant: number, timeZone: string): WallClockParts {
  const values = new Map(
    wallFormatter(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
    millisecond: ((instant % 1_000) + 1_000) % 1_000,
  };
}

function sameWallClock(left: WallClockParts, right: WallClockParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}

function offsetAt(instant: number, timeZone: string): number {
  const parts = partsAt(instant, timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ) - instant
  );
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    // ECMA-402 also accepts numeric offsets in some runtimes. Provider offsets
    // are not zone rules and cannot safely schedule a future event.
    return !/^[+-]\d{2}(?::?\d{2})?$/.test(value);
  } catch {
    return false;
  }
}

/**
 * Resolve a provider wall clock using the zone rules at that event date.
 * Sampling both sides of the date catches DST transitions. A nonexistent
 * spring-forward wall clock and an ambiguous fall-back wall clock are both
 * refused: without an offset/fold bit there is no honest instant to choose.
 */
export function instantFromWallClock(
  value: string,
  timeZone: string,
): string | null {
  const target = parseWallClock(value);
  if (!target || !isIanaTimeZone(timeZone)) return null;
  const naive = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    target.millisecond,
  );
  const offsets = new Set<number>();
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    offsets.add(offsetAt(naive + hours * 3_600_000, timeZone));
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((candidate) => sameWallClock(partsAt(candidate, timeZone), target))
    .sort((left, right) => left - right);
  return candidates.length === 1
    ? new Date(candidates[0]).toISOString()
    : null;
}

export function instantFromRfc3339OrWallClock(
  value: string,
  timeZone: string,
): string | null {
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return instantFromWallClock(value, timeZone);
}

export function wallClockFromInstant(
  value: string,
  timeZone: string,
): string | null {
  if (!isIanaTimeZone(timeZone)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = partsAt(date.getTime(), timeZone);
  const pad = (number: number, width = 2) => String(number).padStart(width, "0");
  const fraction = parts.millisecond ? `.${pad(parts.millisecond, 3)}` : "";
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${fraction}`;
}

export function normalizeCalendarText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\r\n?/g, "\n");
}

/** Match the canonical database snapshot's title boundary before an event is
 * admitted to a provider page. Counting code points (rather than UTF-16 code
 * units) keeps the 500-character limit aligned with Postgres `length(text)`.
 */
export function calendarTitleRefusalReason(
  normalizedTitle: string,
): "empty" | "too_long" | null {
  if (normalizedTitle.trim().length === 0) return "empty";
  return Array.from(normalizedTitle).length > 500 ? "too_long" : null;
}

export async function hashCalendarDescription(
  value: string | null | undefined,
): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeCalendarText(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

export interface CalendarSnapshotSource {
  start: string;
  end: string;
  timeZone: string;
  title: string | null | undefined;
  description: string | null | undefined;
}

/** Build the exact, canonical value object persisted as D137's agreed base. */
export async function normalizeCalendarScheduleSnapshot(
  source: CalendarSnapshotSource,
): Promise<CalendarScheduleSnapshot | null> {
  if (!isIanaTimeZone(source.timeZone)) return null;
  const start = new Date(source.start);
  const end = new Date(source.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end.getTime() <= start.getTime()
  ) {
    return null;
  }
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: source.timeZone,
    title: normalizeCalendarText(source.title),
    descriptionHash: await hashCalendarDescription(source.description),
  };
}

export function appendUnlinkNote(description: string, note: string): string {
  const current = normalizeCalendarText(description).replace(/\s+$/u, "");
  const normalizedNote = normalizeCalendarText(note).trim();
  if (!normalizedNote || current.endsWith(normalizedNote)) return current;
  return current ? `${current}\n\n${normalizedNote}` : normalizedNote;
}
