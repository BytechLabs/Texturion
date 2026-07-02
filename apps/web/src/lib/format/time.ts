import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isSameYear,
} from "date-fns";

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
