import { instantFromZonedWallClock, zonedWallClock } from "@/lib/format/time";

/** The hour a task made from a month day is due, as nobody picked one. */
export const MONTH_CLICK_HOUR = 9;

/**
 * A calendar cell is a day LABEL: its year, month and day are what the
 * grid shows, whatever zone the device is in. The `Date` only carries them.
 */
export function dayKey(day: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(day.getFullYear(), 4)}-${pad(day.getMonth() + 1, 2)}-${pad(day.getDate(), 2)}`;
}

/** A `yyyy-MM-dd` key back to a grid day (local midnight, labels only). */
export function dayFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Today's date on the workspace's wall clock, as a grid day. */
export function todayInZone(now: Date, timeZone: string): Date {
  const wall = zonedWallClock(now.toISOString(), timeZone);
  return wall ? dayFromKey(wall.date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The New task due value for a click on `day`: a `datetime-local` string in
 * the WORKSPACE's zone. Month clicks have no time, so they get the morning
 * default; week clicks carry the slot's hour.
 */
export function slotDueValue(day: Date, hour: number | null): string {
  const h = hour ?? MONTH_CLICK_HOUR;
  return `${dayKey(day)}T${String(h).padStart(2, "0")}:00`;
}

/** The instant a grid day starts at in the workspace zone; the device's midnight if the zone cannot say. */
export function dayStartInstant(day: Date, timeZone: string): string {
  const zoned = instantFromZonedWallClock(`${dayKey(day)}T00:00`, timeZone);
  return zoned.ok ? zoned.iso : day.toISOString();
}

/** The `[start, end)` instants a visible window of whole days asks the API for. */
export function windowInstants(
  first: Date,
  last: Date,
  timeZone: string,
): { after: string; before: string } {
  return {
    after: dayStartInstant(first, timeZone),
    before: dayStartInstant(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), timeZone),
  };
}

/** The day key and hour a task is due in the workspace zone. */
export function dueCell(
  iso: string,
  timeZone: string,
): { key: string; hour: number } {
  const wall = zonedWallClock(iso, timeZone);
  if (wall) return { key: wall.date, hour: wall.hour };
  const at = new Date(iso);
  return { key: dayKey(at), hour: at.getHours() };
}

/** The instant a drop on `day` (and `hour`, in week view) moves a task to; null when it would not move. */
export function droppedDueAt(
  prevIso: string | null,
  day: Date,
  hour: number | null,
  timeZone: string,
  now: Date = new Date(),
): string | null {
  const prev = prevIso ? zonedWallClock(prevIso, timeZone) : null;
  const wall = prev ?? zonedWallClock(now.toISOString(), timeZone);
  if (!wall) return null;
  const h = hour ?? wall.hour;
  const value = `${dayKey(day)}T${String(h).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  const next = instantFromZonedWallClock(value, timeZone);
  if (!next.ok) return null;
  if (prevIso && new Date(prevIso).getTime() === new Date(next.iso).getTime()) return null;
  return next.iso;
}
