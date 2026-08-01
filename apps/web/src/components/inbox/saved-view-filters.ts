import {
  sanitizeFilters,
  type SavedViewFilters,
} from "@loonext/shared";

import type { InboxUrlFilters } from "./filter-url";

/**
 * #280 — the inbox's URL filters, in and out of a saved view.
 *
 * # Why a translation is needed at all
 *
 * The URL and the API do not use the same words, on purpose. The URL carries
 * `assignee=me` because "Mine" is a segment somebody taps and a link somebody
 * pastes; the API carries `assigned_user_id`, a real id, because the list query
 * needs one. A saved view sits between them and has to hold the INTENT, not
 * either serialisation — which is exactly why `assigned_to_me` exists in the
 * shared filter set.
 *
 * # What is deliberately not carried across
 *
 * `q`. The URL keeps search text and a view never stores it: a search is a
 * question asked once, and saving it would turn a shared "my open threads" into
 * "my open threads mentioning boiler" for everyone who opened the shared copy.
 * Applying a view therefore leaves whatever is in the search box alone, which is
 * also what somebody switching views mid-search would expect.
 */

/** The URL's filters as a view would store them. */
export function urlFiltersToView(filters: InboxUrlFilters): SavedViewFilters {
  const raw: Record<string, unknown> = {};
  if (filters.status) raw.status = filters.status;
  if (filters.assignee === "me") raw.assigned_to_me = true;
  else if (filters.assignee) raw.assigned_user_id = filters.assignee;
  if (filters.tag) raw.tag_id = filters.tag;
  if (filters.unread) raw.unread = true;
  if (filters.spam) raw.is_spam = true;
  // The URL's boolean becomes the API's tri-state. `only` is what the chip
  // means: show me what I deferred, rather than everything including it.
  if (filters.snoozed) raw.snoozed = "only";
  // Sanitised here rather than trusted: this is the value that gets stored, and
  // the allow-list is the one place that decides what a view may hold.
  return sanitizeFilters("conversations", raw);
}

/**
 * A view's filters as inbox URL filters.
 *
 * `q` is carried in from the CURRENT url rather than from the view, so applying
 * a view mid-search does not silently clear the search box.
 */
export function viewFiltersToUrl(
  filters: SavedViewFilters,
  current: InboxUrlFilters = {},
): InboxUrlFilters {
  const clean = sanitizeFilters("conversations", filters);
  const out: InboxUrlFilters = {};
  const status = clean.status;
  if (typeof status === "string") {
    out.status = status as InboxUrlFilters["status"];
  }
  if (clean.assigned_to_me === true) out.assignee = "me";
  else if (typeof clean.assigned_user_id === "string") {
    out.assignee = clean.assigned_user_id;
  }
  if (typeof clean.tag_id === "string") out.tag = clean.tag_id;
  if (clean.unread === true) out.unread = true;
  if (clean.is_spam === true) out.spam = true;
  if (clean.snoozed === "only") out.snoozed = true;
  if (current.q !== undefined && current.q.trim() !== "") out.q = current.q;
  return out;
}

/**
 * Is this view the one currently on screen?
 *
 * Compares the SAVED shape rather than the URL, so `assignee=me` and a stored
 * `assigned_to_me` register as the same thing. Search text is excluded on both
 * sides, matching what a view holds — typing in the search box must not make
 * the highlighted view chip go dark.
 */
export function viewMatchesUrl(
  filters: SavedViewFilters,
  url: InboxUrlFilters,
): boolean {
  const a = sanitizeFilters("conversations", filters);
  const b = urlFiltersToView(url);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * A name for the view somebody is about to save, from what they filtered.
 *
 * The save form is never empty. Typing a name is the friction between having
 * arranged a useful screen and keeping it, and the person has already told us
 * what the view is — they built it. They can overwrite it; most will not, and
 * "Open · Unread" is a better name than most people would type anyway.
 *
 * Returns "" when nothing is filtered, because "Everything" is a name to offer
 * only if somebody deliberately saves the unfiltered list.
 */
export function suggestViewName(
  filters: InboxUrlFilters,
  labels: { tag?: string; assignee?: string } = {},
): string {
  const parts: string[] = [];
  if (filters.status) {
    parts.push(filters.status.charAt(0).toUpperCase() + filters.status.slice(1));
  }
  if (filters.assignee === "me") parts.push("Mine");
  else if (filters.assignee && labels.assignee) parts.push(labels.assignee);
  if (filters.tag && labels.tag) parts.push(labels.tag);
  if (filters.unread) parts.push("Unread");
  if (filters.spam) parts.push("Spam");
  if (filters.snoozed) parts.push("Snoozed");
  // A middot rather than a dash: Law 6 bans em and en dashes in rendered copy,
  // and a hyphen reads as part of a word.
  return parts.join(" · ");
}
