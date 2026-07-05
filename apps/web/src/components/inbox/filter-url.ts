import type { ConversationFilters } from "@/lib/api/filters";
import type { ConversationStatus } from "@/lib/api/types";

/**
 * URL is the state for inbox filters (APP-LAYOUT-V2 §2: `/inbox?status=&assignee=
 * &tag=&unread=&spam=&q=`). These pure functions translate between the URL search
 * params, the persistent segmented control ("Open | Mine | All | Closed"), the
 * removable secondary chips, and the GET /v1/conversations filter object.
 *
 * There is no filter drawer anymore (§2): the segment owns `status`+the-me
 * assignee, and every secondary dimension (assignee / tag / unread / spam) is a
 * visible chip that round-trips through the URL, added via the `+ Filter` cmdk
 * popover. Unit-tested directly.
 */

export interface InboxUrlFilters {
  status?: ConversationStatus;
  /** `"me"` (the Mine segment) or a member user id from the `+ Filter` popover. */
  assignee?: string;
  tag?: string;
  unread?: boolean;
  /** Spam never shows in the default list — this chip reveals it (§2.2). */
  spam?: boolean;
  q?: string;
}

const STATUSES: readonly ConversationStatus[] = [
  "new",
  "open",
  "waiting",
  "closed",
];

function isStatus(value: string): value is ConversationStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/** Parse the /inbox search params; unknown values are dropped, never thrown. */
export function parseInboxSearchParams(
  params: URLSearchParams,
): InboxUrlFilters {
  const filters: InboxUrlFilters = {};
  const status = params.get("status");
  if (status !== null && isStatus(status)) filters.status = status;
  const assignee = params.get("assignee");
  if (assignee) filters.assignee = assignee;
  const tag = params.get("tag");
  if (tag) filters.tag = tag;
  // Accept both "true" (what the app writes) and "1" (the documented shorthand)
  // so hand-typed / shared URLs in either form apply correctly.
  const isTruthy = (v: string | null) => v === "true" || v === "1";
  if (isTruthy(params.get("unread"))) filters.unread = true;
  if (isTruthy(params.get("spam"))) filters.spam = true;
  const q = params.get("q");
  if (q !== null && q.trim() !== "") filters.q = q;
  return filters;
}

/**
 * Serialize back to a query string ("" when everything is default) — stable
 * key order so equal filters produce identical URLs.
 */
export function serializeInboxFilters(filters: InboxUrlFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assignee) params.set("assignee", filters.assignee);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.unread) params.set("unread", "true");
  if (filters.spam) params.set("spam", "true");
  if (filters.q !== undefined && filters.q.trim() !== "") {
    params.set("q", filters.q);
  }
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

export type InboxSegment = "open" | "mine" | "all" | "closed";

export const INBOX_SEGMENTS: readonly { id: InboxSegment; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
  { id: "closed", label: "Closed" },
];

/** Which segment the current URL filters light up. */
export function segmentOf(filters: InboxUrlFilters): InboxSegment {
  if (filters.assignee === "me") return "mine";
  if (filters.status === "open") return "open";
  if (filters.status === "closed") return "closed";
  return "all";
}

/**
 * Apply a segment tap: segments own `status` + the "me" assignee; the secondary
 * chips (tag, unread, spam), a specific-member assignee, and the search query
 * all survive the switch.
 */
export function applySegment(
  filters: InboxUrlFilters,
  segment: InboxSegment,
): InboxUrlFilters {
  const next: InboxUrlFilters = { ...filters };
  delete next.status;
  if (next.assignee === "me") delete next.assignee;
  if (segment === "open") next.status = "open";
  if (segment === "closed") next.status = "closed";
  if (segment === "mine") next.assignee = "me";
  return next;
}

/**
 * #11 a11y: the segmented status control is a WAI-ARIA tablist, so Arrow / Home
 * / End must move the selection (roving tabindex). Given the pressed key, the
 * current segment index, and the segment count, return the next index — wrapping
 * at both ends — or the SAME index for any key the tablist doesn't handle (so
 * the caller can early-return without preventing default). Pure, so the
 * filter-bar keyboard handler is unit-testable without a DOM.
 */
export function nextSegmentIndex(
  key: string,
  current: number,
  count: number,
): number {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

/**
 * The GET /v1/conversations filter object for the current URL. `q` drives
 * the /v1/search view instead of the list (§2.4), so it is never forwarded.
 */
export function toConversationFilters(
  filters: InboxUrlFilters,
  userId: string,
): ConversationFilters {
  const out: ConversationFilters = {};
  if (filters.status) out.status = filters.status;
  if (filters.assignee) {
    out.assigned_user_id = filters.assignee === "me" ? userId : filters.assignee;
  }
  if (filters.tag) out.tag_id = filters.tag;
  if (filters.unread) out.unread = true;
  if (filters.spam) out.is_spam = true;
  return out;
}

/** True when anything beyond the plain "All" view is active (empty-state copy). */
export function hasActiveFilters(filters: InboxUrlFilters): boolean {
  return Boolean(
    filters.status ||
      filters.assignee ||
      filters.tag ||
      filters.unread ||
      filters.spam ||
      (filters.q !== undefined && filters.q.trim() !== ""),
  );
}

// ---------------------------------------------------------------------------
// §2.1 Open-only count
// ---------------------------------------------------------------------------

/**
 * §2.1: a single quiet count on the **Open** segment only ("what needs
 * handling"), never on Mine/All/Closed. This is the list filter that count is
 * measured against — the bare Open queue (secondary chips deliberately excluded
 * so the number is stable and means "open conversations," not "open matching my
 * current chips"). Reuses the real GET /v1/conversations endpoint; the cap
 * (§2.1: `9+`) means the first page always suffices.
 */
export const OPEN_COUNT_FILTERS: ConversationFilters = { status: "open" };

/** §2.1: counts cap at `9+` so the tab bar never becomes a KPI strip. */
export const OPEN_COUNT_CAP = 9;

/** Render the capped count ("" when 0 — the count only shows when `> 0`). */
export function formatOpenCount(count: number): string {
  if (count <= 0) return "";
  return count > OPEN_COUNT_CAP ? `${OPEN_COUNT_CAP}+` : String(count);
}

// ---------------------------------------------------------------------------
// §2.2 Secondary chip descriptors (shared by the bar + the `+ Filter` popover)
// ---------------------------------------------------------------------------

/** The URL params a secondary chip / the `+ Filter` popover can toggle. */
export type SecondaryFilterKey = "assignee" | "tag" | "unread" | "spam";

/**
 * The secondary filters that are currently active, in a stable render order,
 * each carrying the URL key to clear. Labels are resolved by the caller (they
 * need the tags/members lookups) — this stays pure and testable.
 */
export interface ActiveChip {
  key: SecondaryFilterKey;
  /** For assignee/tag, the raw id/value; for unread/spam, undefined. */
  value?: string;
}

/**
 * The active secondary chips for a filter set. The `me` assignee is owned by
 * the Mine segment (§2.1), so it is never rendered as a removable chip — only a
 * specific-member assignee is.
 */
export function activeChips(filters: InboxUrlFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (filters.assignee && filters.assignee !== "me") {
    chips.push({ key: "assignee", value: filters.assignee });
  }
  if (filters.tag) chips.push({ key: "tag", value: filters.tag });
  if (filters.unread) chips.push({ key: "unread" });
  if (filters.spam) chips.push({ key: "spam" });
  return chips;
}

/** Clear one secondary dimension, returning the next filter set. */
export function clearSecondary(
  filters: InboxUrlFilters,
  key: SecondaryFilterKey,
): InboxUrlFilters {
  const next = { ...filters };
  delete next[key];
  return next;
}
