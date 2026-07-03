import type { ThreadItem } from "./clusters";

/**
 * In-thread filter model (APP-LAYOUT-V2 §5.1): a cheap client-side view over
 * already-built thread items (D21) — it filters, it never refetches. Pure, so
 * it is unit-tested directly; the segmented control lives in
 * `thread-filter-bar.tsx`.
 *
 * State may be URL-encoded (`?thread=`) for shareability but defaults to All
 * and need not persist.
 */

export const THREAD_FILTERS = ["all", "messages", "notes", "events"] as const;
export type ThreadFilter = (typeof THREAD_FILTERS)[number];

export const THREAD_FILTER_LABELS: Record<ThreadFilter, string> = {
  all: "All",
  messages: "Messages",
  notes: "Notes",
  events: "Events",
};

/** Parse `?thread=` — unknown/absent values fall back to the All default. */
export function parseThreadFilter(
  value: string | null | undefined,
): ThreadFilter {
  return value !== null && value !== undefined && isThreadFilter(value)
    ? value
    : "all";
}

function isThreadFilter(value: string): value is ThreadFilter {
  return (THREAD_FILTERS as readonly string[]).includes(value);
}

/**
 * §5.1 view semantics over the built timeline items:
 *  - all      — the full interleaved stream (dividers + clusters + events).
 *  - messages — inbound/outbound clusters only (notes and events dropped).
 *  - notes    — note clusters only.
 *  - events   — centered timeline event lines only.
 *
 * Day dividers are kept only in All so the filtered views stay a clean list
 * (a divider with nothing under it would read as a stray date). Pure and cheap
 * to run inside a useMemo.
 */
export function filterThreadItems(
  items: readonly ThreadItem[],
  filter: ThreadFilter,
): ThreadItem[] {
  if (filter === "all") return items as ThreadItem[];
  return items.filter((item) => {
    switch (filter) {
      case "messages":
        return (
          item.kind === "cluster" &&
          (item.direction === "inbound" || item.direction === "outbound")
        );
      case "notes":
        return item.kind === "cluster" && item.direction === "note";
      case "events":
        return item.kind === "event";
    }
  });
}

/** The §5.1 empty-view copy for a filter that matched nothing. */
export function threadFilterEmptyCopy(filter: ThreadFilter): string {
  switch (filter) {
    case "messages":
      return "No messages yet.";
    case "notes":
      return "No internal notes on this conversation.";
    case "events":
      return "Nothing has happened on this conversation yet.";
    case "all":
      return "No messages yet — say hello below.";
  }
}
