import type { ThreadItem } from "./clusters";

/**
 * In-thread filter model (APP-LAYOUT-V2 §5.1): a cheap client-side view over
 * already-built thread items (D21) — it filters, it never refetches. Pure, so
 * it is unit-tested directly; the toggle control lives in
 * `thread-filter-bar.tsx`.
 *
 * #89: the timeline shows three content kinds — messages, notes, events — and
 * each is an INDEPENDENT toggle (mix-and-match), all on by default. There is no
 * single "All" mode: every-toggle-on IS the full stream. At least one toggle is
 * always on (a hidden-everything timeline is never a reachable state), so the
 * view is never silently blank.
 *
 * State may be URL-encoded (`?thread=` — a comma list of the enabled kinds) for
 * shareability but defaults to all-on and need not persist.
 */

export const THREAD_CATEGORIES = ["messages", "notes", "events"] as const;
export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

/** Which content kinds are currently shown. All-on is the default full stream. */
export type ThreadFilter = Readonly<Record<ThreadCategory, boolean>>;

export const THREAD_CATEGORY_LABELS: Record<ThreadCategory, string> = {
  messages: "Messages",
  notes: "Notes",
  events: "Events",
};

/** The default: every content kind visible (the full interleaved stream). */
export const ALL_CATEGORIES_ON: ThreadFilter = {
  messages: true,
  notes: true,
  events: true,
};

/** Every toggle on — the full stream (dividers included). */
export function isAllOn(filter: ThreadFilter): boolean {
  return filter.messages && filter.notes && filter.events;
}

/** The enabled kinds, in canonical order — for chips/labels. */
export function enabledCategories(filter: ThreadFilter): ThreadCategory[] {
  return THREAD_CATEGORIES.filter((category) => filter[category]);
}

/**
 * Flip one kind. A toggle-off that would hide EVERY kind is refused (the last
 * enabled kind stays on) so the timeline is never a blank list — mix-and-match
 * narrows down to a single kind at most.
 */
export function toggleThreadCategory(
  filter: ThreadFilter,
  category: ThreadCategory,
): ThreadFilter {
  const next = { ...filter, [category]: !filter[category] };
  if (!next.messages && !next.notes && !next.events) return filter;
  return next;
}

/**
 * Parse `?thread=` — a comma list of enabled kinds (e.g. `messages,events`).
 * Absent / empty / all-unknown falls back to all-on so the timeline is never
 * blank by default. Only the known kinds survive; a value that names none of
 * them is treated as absent.
 */
export function parseThreadFilter(
  value: string | null | undefined,
): ThreadFilter {
  if (value === null || value === undefined || value === "") {
    return ALL_CATEGORIES_ON;
  }
  const enabled = new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(isThreadCategory),
  );
  if (enabled.size === 0) return ALL_CATEGORIES_ON;
  return {
    messages: enabled.has("messages"),
    notes: enabled.has("notes"),
    events: enabled.has("events"),
  };
}

/**
 * Serialize for `?thread=`. All-on is the default, so it drops the param
 * entirely (null → the caller deletes it); any subset becomes the comma list of
 * enabled kinds.
 */
export function serializeThreadFilter(filter: ThreadFilter): string | null {
  if (isAllOn(filter)) return null;
  return enabledCategories(filter).join(",");
}

function isThreadCategory(value: string): value is ThreadCategory {
  return (THREAD_CATEGORIES as readonly string[]).includes(value);
}

/** The content kind a built timeline item belongs to (dividers: none). */
function itemCategory(item: ThreadItem): ThreadCategory | null {
  if (item.kind === "cluster") {
    if (item.direction === "inbound" || item.direction === "outbound") {
      return "messages";
    }
    if (item.direction === "note") return "notes";
    return null;
  }
  if (item.kind === "event") return "events";
  return null; // day dividers and anything else carry no kind of their own.
}

/**
 * §5.1 view semantics over the built timeline items. Keep any item whose kind
 * is toggled on. All-on returns the untouched stream (dividers + clusters +
 * events); any subset drops day dividers so a filtered view stays a clean list
 * (a divider with nothing under it would read as a stray date). Pure and cheap
 * to run inside a useMemo.
 */
export function filterThreadItems(
  items: readonly ThreadItem[],
  filter: ThreadFilter,
): ThreadItem[] {
  if (isAllOn(filter)) return items as ThreadItem[];
  return items.filter((item) => {
    const category = itemCategory(item);
    return category !== null && filter[category];
  });
}

/** The §5.1 empty-view copy for a filter that matched nothing. */
export function threadFilterEmptyCopy(filter: ThreadFilter): string {
  if (isAllOn(filter)) return "No messages yet. Say hello below.";
  const on = enabledCategories(filter);
  if (on.length === 1) {
    switch (on[0]) {
      case "messages":
        return "No messages yet.";
      case "notes":
        return "No internal notes on this conversation.";
      case "events":
        return "Nothing has happened on this conversation yet.";
    }
  }
  return "Nothing to show with the current filters.";
}
