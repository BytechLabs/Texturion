import {
  isInboxFiltered,
  type InboxFilterState,
} from "@loonext/shared";

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
  /**
   * #293: nor does a thread this member deferred. Same shape as `spam` — a
   * population hidden from the default view, revealed by one removable chip —
   * because that pattern already exists here and a second invention of it is
   * how two hidden populations end up behaving differently.
   */
  snoozed?: boolean;
  /**
   * #508: threads nobody has replied to yet. Same removable-chip shape as the
   * two above, and the DESTINATION the response-time card's "N leads nobody
   * answered" row links to — which is why it has to survive a paste of the URL
   * rather than only existing as a chip somebody taps.
   */
  awaiting?: boolean;
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
  if (isTruthy(params.get("snoozed"))) filters.snoozed = true;
  if (isTruthy(params.get("awaiting"))) filters.awaiting = true;
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
  if (filters.snoozed) params.set("snoozed", "true");
  if (filters.awaiting) params.set("awaiting", "true");
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
  // #293: the chip asks for the deferred ones INSTEAD of the ordinary list,
  // not as well — "what did I defer" is a view, not a widening. Absent leaves
  // the field off entirely, which is the server's hide-them default.
  if (filters.snoozed) out.snoozed = "only";
  // #508: the URL boolean becomes the API's tri-state, same as `snoozed` above.
  // "only" is what the chip means — show me the ones still waiting, rather than
  // everything including them.
  if (filters.awaiting) out.awaiting = "only";
  return out;
}

/**
 * This URL, in the shape the shared rule reads (#548).
 *
 * The rule used to be written out once per client — here, in InboxTab.kt and in
 * InboxTab.swift — and two of the three had forgotten that the status segment is
 * a filter. Three copies, two wrong. So there is one copy now and web reads it
 * rather than being a fourth.
 */
export function toInboxFilterState(filters: InboxUrlFilters): InboxFilterState {
  const named =
    filters.assignee !== undefined && filters.assignee !== "me"
      ? filters.assignee
      : null;
  return {
    // Open is the phones' home view; on web the home view is a bare URL, so
    // every status here — Open included — is the segment having moved.
    segment: filters.status ?? null,
    assignedToMe: filters.assignee === "me",
    assigneeUserId: named,
    tagId: filters.tag ?? null,
    unreadOnly: filters.unread === true,
    spamOnly: filters.spam === true,
    snoozedOnly: filters.snoozed === true,
    awaitingOnly: filters.awaiting === true,
  };
}

/** Is there a search query long enough to matter (§2.4)? */
export function searchQueryOf(filters: InboxUrlFilters): string {
  return filters.q?.trim() ?? "";
}

/** §2.4: below this the query is still being typed and the list stays put. */
export const INBOX_SEARCH_MIN_CHARS = 2;

/**
 * Has the query taken the pane over (§2.4)?
 *
 * One place, because two answers to this would be two different screens: the
 * pane swaps the list for /v1/search on one rule, and the filter bar has to go
 * quiet on the SAME one — search reads every conversation, so a status tab it
 * left lit would be a control that changes nothing.
 */
export function isSearchingInbox(filters: InboxUrlFilters): boolean {
  return searchQueryOf(filters).length >= INBOX_SEARCH_MIN_CHARS;
}

/**
 * True when the list is narrowed by anything at all — what the empty-state copy
 * asks, and what Clear all offers to undo.
 *
 * `q` is checked HERE and is deliberately not one of the shared dimensions: a
 * search REPLACES the list with results from every conversation rather than
 * narrowing this one, on all three clients. It still counts for this question,
 * because a one-character `q` is too short to swap the pane and leaves the list
 * looking unfiltered while the empty state has to explain itself.
 */
export function hasActiveFilters(filters: InboxUrlFilters): boolean {
  return isInboxFiltered(toInboxFilterState(filters)) ||
    searchQueryOf(filters) !== "";
}

/** Back to the unfiltered list: no status, no chips, no query. */
export function clearAllFilters(): InboxUrlFilters {
  return {};
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
export type SecondaryFilterKey =
  | "status"
  | "assignee"
  | "tag"
  | "unread"
  | "spam"
  | "snoozed"
  | "awaiting";

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
  // #548: a status no segment can show gets a chip, so it is at least visible
  // and removable. First in the row because it is the widest of these — it
  // decides which conversations exist before any chip narrows them.
  const orphan = unrepresentedStatus(filters);
  if (orphan !== null) chips.push({ key: "status", value: orphan });
  if (filters.assignee && filters.assignee !== "me") {
    chips.push({ key: "assignee", value: filters.assignee });
  }
  if (filters.tag) chips.push({ key: "tag", value: filters.tag });
  if (filters.unread) chips.push({ key: "unread" });
  if (filters.spam) chips.push({ key: "spam" });
  if (filters.snoozed) chips.push({ key: "snoozed" });
  if (filters.awaiting) chips.push({ key: "awaiting" });
  return chips;
}

/** What each status is called when it has to be shown as a chip (#548). */
export const STATUS_CHIP_LABELS: Record<ConversationStatus, string> = {
  new: "New",
  open: "Open",
  waiting: "Waiting on them",
  closed: "Closed",
};

/**
 * A status the segmented control cannot represent, or `null` (#548).
 *
 * `new` and `waiting` are two of the four statuses a saved view may store
 * (packages/shared/src/saved-views.ts), and neither is a segment. `segmentOf`
 * answered "all" for both, so the All tab lit up while the list was quietly
 * narrowed to one status, with nothing on screen to say so and nothing to press
 * to undo it.
 *
 * Asked as a round trip — does the segment this URL lights reproduce this
 * status? — rather than by naming the two, so a fifth status appears as a chip
 * on the day it is added rather than on the day somebody notices.
 */
export function unrepresentedStatus(
  filters: InboxUrlFilters,
): ConversationStatus | null {
  const { status } = filters;
  if (status === undefined) return null;
  const roundTrip = applySegment(filters, segmentOf(filters)).status;
  return roundTrip === status ? null : status;
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
