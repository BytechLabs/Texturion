import type { ConversationFilters } from "@/lib/api/filters";
import type { ConversationStatus } from "@/lib/api/types";

/**
 * URL is the state for inbox filters (G3: `/inbox?status=&assignee=&tag=&q=`).
 * These pure functions translate between the URL search params, the segmented
 * control (G4: "Open | Mine | All | Closed"), and the GET /v1/conversations
 * filter object. Unit-tested directly.
 */

export interface InboxUrlFilters {
  status?: ConversationStatus;
  /** `"me"` (the Mine segment) or a member user id from the filter sheet. */
  assignee?: string;
  tag?: string;
  unread?: boolean;
  /** Spam never shows in the default list — this chip reveals it (G4). */
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
  if (params.get("unread") === "true") filters.unread = true;
  if (params.get("spam") === "true") filters.spam = true;
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
 * Apply a segment tap: segments own `status` + the "me" assignee; sheet
 * filters (tag, unread, spam) and the search query survive the switch.
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
 * The GET /v1/conversations filter object for the current URL. `q` drives
 * the /v1/search view instead of the list (G4), so it is never forwarded.
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
