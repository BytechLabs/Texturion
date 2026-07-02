import type { ConversationListItem, ConversationStatus } from "./types";

/** GET /v1/conversations query filters (SPEC §7, G3: URL is the state). */
export interface ConversationFilters {
  status?: ConversationStatus;
  assigned_user_id?: string;
  tag_id?: string;
  is_spam?: boolean;
  unread?: boolean;
  q?: string;
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
  return out;
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
  if (filters.q !== undefined) return null; // server-side trigram match
  return true;
}
