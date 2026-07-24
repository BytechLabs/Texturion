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

  const contact = task.contact;
  if (!contact) return null;
  const fallback = validCoords(contact.lat, contact.lng);
  return fallback ? { ...fallback, name: contact.name } : null;
}
