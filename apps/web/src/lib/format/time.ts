import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isSameYear,
} from "date-fns";

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
  // timeZoneName cannot combine with dateStyle/timeStyle — components only.
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/**
 * Relative timestamps for list rows (G4/G10): `2m`, `1h`, `Tue` under
 * 7 days; absolute (`Jun 12`, `Jun 12 2025`) after.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h`;
  const days = differenceInDays(now, date);
  if (days < 7) return format(date, "EEE");
  if (isSameYear(date, now)) return format(date, "MMM d");
  return format(date, "MMM d yyyy");
}
