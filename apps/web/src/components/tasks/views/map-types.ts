import type { Task } from "@/lib/api/types";

/**
 * A task carrying resolved coordinates for the Map view.
 *
 * The frozen tasks list endpoint filters `has_location=true` using the contact's
 * cached `lat`/`lng` (geocoded once, cached on the contacts row — HOME-AND-VIEWS
 * "Map view technology"), but its response body carries NO coordinates: the join
 * is used only to narrow the set (apps/api/src/routes/tasks.ts). `taskCoords`
 * therefore reads the OPTIONAL, forward-compatible `contact` embed DEFENSIVELY —
 * it plots whatever coordinates the API actually provides and counts everything
 * else as "no location", so it never fabricates a pin and never crashes on a row
 * without coordinates (today that is every row; if a later backend wave projects
 * the located contact, the same code lights the pins up).
 */

/** A task the map can pin: a `Task` plus concrete coordinates + a label. */
export interface LocatedTask extends Task {
  lat: number;
  lng: number;
  contactName: string | null;
  stop?: number;
}

/** Finite, on-Earth coordinates or null (a bad geocode must never plot). */
function validCoords(
  lat: number | null,
  lng: number | null,
): { lat: number; lng: number } | null {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * Extract usable coordinates from a task row, or null when it has none.
 *
 * PREFERS the task's OWN geocoded address (task_geocode) over the contact's
 * cached geocode — a task names a job SITE ("CN Tower, Toronto") that often
 * differs from where the contact lives (their Calgary address). Falls back to
 * the contact's location when the task has no address of its own. Guards against
 * non-finite / out-of-range values so a bad geocode never plots.
 */
export function taskCoords(
  task: Task,
): { lat: number; lng: number; name: string | null } | null {
  const own = validCoords(task.lat ?? null, task.lng ?? null);
  if (own) return { ...own, name: task.contact?.name ?? null };

  const {contact} = task;
  if (!contact) return null;
  const fallback = validCoords(contact.lat, contact.lng);
  return fallback ? { ...fallback, name: contact.name } : null;
}

/**
 * A Google Maps *directions* URL to a point — the universal `?api=1` Maps URL
 * scheme, no API key and no per-request cost. On desktop it opens Maps
 * directions from the user's location; on a phone browser it deep-links the
 * native Google Maps / Apple Maps app. Built from the exact geocoded
 * coordinate the pin shows (not the free-text address), so "Directions" lands
 * a field crew on the job site, not an ambiguous address match.
 */
export function mapsDirectionsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function mapsRouteHref(stops: readonly LocatedTask[]): string {
  const points = stops.slice(0, 9).map(({ lat, lng }) => `${lat},${lng}`);
  const destination = points.pop();
  if (destination === undefined) return "";
  const query = new URLSearchParams({ api: "1", destination });
  if (points.length > 0) query.set("waypoints", points.join("|"));
  return `https://www.google.com/maps/dir/?${query}`;
}

export function mapDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function taskMapDay(task: Task): string | undefined {
  return task.due_on ?? (task.due_at ? mapDay(new Date(task.due_at)) : undefined);
}

export function compareMapStops(a: Task, b: Task): number {
  const byDay = (taskMapDay(a) ?? "9999").localeCompare(taskMapDay(b) ?? "9999");
  const byTime = (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity);
  return byDay || byTime || a.id.localeCompare(b.id);
}
