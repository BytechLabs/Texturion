import type { ConversationListItem, ConversationStatus } from "./types";

/** GET /v1/conversations query filters (SPEC §7, G3: URL is the state). */
export interface ConversationFilters {
  status?: ConversationStatus;
  assigned_user_id?: string;
  tag_id?: string;
  is_spam?: boolean;
  unread?: boolean;
  q?: string;
  /**
   * #293 deferral. Absent is the product default — the ordinary inbox does not
   * show what you deferred — so this only ever carries an explicit "show me
   * what I deferred" ('only') or "show everything" ('all').
   */
  snoozed?: "only" | "all";
  /**
   * #508: threads nobody has replied to yet — the #388 lead clock
   * (`awaiting_reply_since`), not `status`. Absent means no filter at all: the
   * ordinary inbox shows answered and unanswered alike, and only a reader who
   * arrived from the response-time card is asking the narrower question.
   */
  awaiting?: "only" | "exclude";
}

/**
 * Drop undefined/empty members so semantically equal filter objects produce
 * identical query keys.
 */
export function normalizeFilters(
  filters: ConversationFilters,
): ConversationFilters {
  const out: ConversationFilters = {};
  if (filters.status !== undefined) out.status = filters.status;
  if (filters.assigned_user_id !== undefined) {
    out.assigned_user_id = filters.assigned_user_id;
  }
  if (filters.tag_id !== undefined) out.tag_id = filters.tag_id;
  if (filters.is_spam !== undefined) out.is_spam = filters.is_spam;
  if (filters.unread !== undefined) out.unread = filters.unread;
  if (filters.q !== undefined && filters.q.trim() !== "") {
    out.q = filters.q.trim();
  }
  if (filters.snoozed !== undefined) out.snoozed = filters.snoozed;
  if (filters.awaiting !== undefined) out.awaiting = filters.awaiting;
  return out;
}

/**
 * #293: is this row currently deferred by the caller?
 *
 * Computed from the return time rather than from the row's presence, matching
 * the server exactly: a snooze whose moment has passed is simply over, with no
 * sweep to run late and no window where a returned thread stays hidden.
 */
export function isSnoozed(
  item: Pick<ConversationListItem, "snoozed_until">,
  now: number = Date.now(),
): boolean {
  if (!item.snoozed_until) return false;
  const until = Date.parse(item.snoozed_until);
  return !Number.isNaN(until) && until > now;
}

/**
 * Client-side re-evaluation of the server's list filters, used by the cache
 * reducers to decide whether an updated conversation still belongs in a
 * cached list (G12: patch precisely instead of refetching).
 *
 * Returns `true` (match), `false` (no match), or `null` when the filter
 * cannot be evaluated locally (`q`, `unread` on foreign rows) — callers
 * treat null as "keep what's there, let staleness handle it".
 */
export function conversationMatchesFilters(
  item: ConversationListItem,
  filters: ConversationFilters,
): boolean | null {
  // Spam never shows outside the spam view (SPEC §6 threading step 3).
  const wantSpam = filters.is_spam === true;
  if (item.is_spam !== wantSpam) return false;
  // #293: the same rule the server applies, so a thread deferred in one tab
  // leaves the cached list instead of sitting there until it goes stale — and
  // so an un-snooze puts it back without a refetch.
  if (filters.snoozed !== "all") {
    const deferred = isSnoozed(item);
    if (deferred !== (filters.snoozed === "only")) return false;
  }
  if (filters.status !== undefined && item.status !== filters.status) {
    return false;
  }
  if (
    filters.assigned_user_id !== undefined &&
    item.assigned_user_id !== filters.assigned_user_id
  ) {
    return false;
  }
  if (
    filters.tag_id !== undefined &&
    !item.tags.some((tag) => tag.id === filters.tag_id)
  ) {
    return false;
  }
  if (filters.unread === true && !item.unread) return false;
  // #508: the same rule the server applies, so answering a thread takes it out
  // of the Unanswered list without a refetch. A row that does not carry the
  // field cannot be judged — an older cached payload predates it — and
  // "unknown" must not read as "answered", which would drop a waiting lead off
  // the one screen that exists to name it.
  if (filters.awaiting !== undefined) {
    if (item.awaiting_reply_since === undefined) return null;
    const waiting = item.awaiting_reply_since !== null;
    if (waiting !== (filters.awaiting === "only")) return false;
  }
  if (filters.q !== undefined) return null; // server-side trigram match
  return true;
}
