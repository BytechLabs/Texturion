import { hasUnseenWhatsNew } from "@loonext/shared";

/**
 * #321 — when this member last looked at what's new.
 *
 * # Why local, and not a column
 *
 * A marker is a courtesy, not a fact about the workspace. Storing it
 * server-side would make it consistent across devices at the cost of a
 * migration, a route, and a write on a screen open, for a dot. The failure mode
 * of the local version is that a member who opens the app on a second device
 * sees the marker once more; the failure mode of getting the server version
 * wrong is a write path on every settings render.
 *
 * That trade is only defensible because of the FLOOR below. Without it, local
 * storage would light the badge for every device that has never seen it, which
 * is every device on the day this ships.
 *
 * # The floor is what stops the badge being useless
 *
 * `hasUnseenWhatsNew` takes the member's join date as the fallback: somebody
 * who signed up today has no memory of missing anything, and a badge
 * advertising six months of changes is one they learn to ignore immediately. A
 * badge that is always lit is a badge nobody reads.
 */

const KEY = "loonext:whats-new-seen";

/** The stored ISO instant, or null when they have never opened it here. */
export function readWhatsNewSeen(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    // Anything that is not an ISO-ish instant is treated as never seen — a
    // hand-edited value must not silently suppress the marker forever.
    return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Stamp now. Called when the list is opened, not when the app loads. */
export function markWhatsNewSeen(now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, now.toISOString());
  } catch {
    // Storage blocked. The marker stays lit, which is the harmless direction.
  }
}

/**
 * Should the marker show?
 *
 * `joinedAt` comes from the membership. Null means we do not know when they
 * arrived, and the shared rule says nothing rather than guessing — a wrong
 * badge costs trust in every later one.
 */
export function shouldShowWhatsNewMarker(joinedAt: string | null): boolean {
  return hasUnseenWhatsNew(readWhatsNewSeen(), joinedAt);
}
