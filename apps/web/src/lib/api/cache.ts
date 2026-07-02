import type { InfiniteData } from "@tanstack/react-query";

import {
  conversationMatchesFilters,
  type ConversationFilters,
} from "./filters";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationSnippet,
  Message,
  MessageStatus,
  Page,
} from "./types";

/**
 * Pure cache-patch reducers (G12): realtime events and mutation results are
 * applied to the Query cache by ID with these functions — no refetch storms.
 * Every reducer returns a NEW object when something changed and the SAME
 * reference when nothing did (so setQueryData can no-op cheaply). All are
 * side-effect free and unit-tested as plain functions.
 */

export type ThreadData = InfiniteData<Page<Message>>;
export type ConversationListData = InfiniteData<Page<ConversationListItem>>;

/** DESC comparator over (timestamp, id) — the SPEC §7 sort key. */
function byKeyDesc(
  aTs: string,
  aId: string,
  bTs: string,
  bId: string,
): number {
  const a = Date.parse(aTs);
  const b = Date.parse(bTs);
  if (a !== b) return b - a;
  return bId < aId ? -1 : bId > aId ? 1 : 0;
}

/** Shape a full message into the list row's `last_message` embed (G4). */
export function snippetFromMessage(message: Message): ConversationSnippet {
  return {
    id: message.id,
    direction: message.direction,
    body: message.body,
    created_at: message.created_at,
    has_attachments: (message.attachments?.length ?? 0) > 0,
  };
}

/** An empty single-page infinite structure to seed from realtime/compose. */
export function emptyThread(): ThreadData {
  return { pages: [{ data: [], next_cursor: null }], pageParams: [undefined] };
}

/**
 * Merge messages into a thread (newest-first pages). Existing rows are
 * replaced in place by id (status/segments updates); unseen rows are inserted
 * into page 1, which is then re-sorted on (created_at, id) DESC. Used for
 * send results, note creation, and `message.created` refetches.
 */
export function threadUpsertMessages(
  thread: ThreadData | undefined,
  incoming: readonly Message[],
): ThreadData {
  const base = thread ?? emptyThread();
  if (incoming.length === 0) return base;

  const byId = new Map(incoming.map((message) => [message.id, message]));
  const inserted = new Set<string>();
  let changed = false;

  const pages = base.pages.map((page) => {
    let pageChanged = false;
    const data = page.data.map((existing) => {
      const replacement = byId.get(existing.id);
      if (!replacement) return existing;
      inserted.add(existing.id);
      if (existing === replacement) return existing;
      pageChanged = true;
      return replacement;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, data };
  });

  const fresh = incoming.filter((message) => !inserted.has(message.id));
  if (fresh.length > 0) {
    changed = true;
    const first = pages[0] ?? { data: [], next_cursor: null };
    const merged = [...fresh, ...first.data].sort((a, b) =>
      byKeyDesc(a.created_at, a.id, b.created_at, b.id),
    );
    pages[0] = { ...first, data: merged };
  }

  if (!changed) return base;
  return { pages, pageParams: base.pageParams };
}

/**
 * Targeted patch of one message by id (the `message.status` broadcast and the
 * retry mutation). Returns the same reference when the message is not cached.
 */
export function threadPatchMessage(
  thread: ThreadData,
  messageId: string,
  patch: Partial<Message>,
): ThreadData {
  let changed = false;
  const pages = thread.pages.map((page) => {
    const index = page.data.findIndex((message) => message.id === messageId);
    if (index === -1) return page;
    const current = page.data[index];
    const next = { ...current, ...patch };
    changed = true;
    const data = page.data.slice();
    data[index] = next;
    return { ...page, data };
  });
  if (!changed) return thread;
  return { pages, pageParams: thread.pageParams };
}

/** Convenience wrapper for the `message.status` broadcast payload. */
export function threadApplyStatus(
  thread: ThreadData,
  messageId: string,
  status: MessageStatus,
): ThreadData {
  return threadPatchMessage(thread, messageId, { status });
}

/**
 * The optimistic D14 done patch (PATCH /v1/messages/:id): done=true stamps
 * now + the acting user; done=false clears both — mirroring exactly what the
 * API writes so the optimistic row and the server row agree in shape.
 */
export function doneMutationPatch(
  done: boolean,
  userId: string | null,
  now: Date = new Date(),
): Pick<Message, "done_at" | "done_by_user_id"> {
  return done
    ? { done_at: now.toISOString(), done_by_user_id: userId }
    : { done_at: null, done_by_user_id: null };
}

/**
 * Patch one message inside a detail response's embedded first page (the
 * GET /v1/conversations/:id cache). Same reference when nothing changed.
 */
export function detailPatchMessage(
  detail: ConversationDetail | undefined,
  messageId: string,
  patch: Partial<Message>,
): ConversationDetail | undefined {
  if (!detail) return detail;
  let changed = false;
  const data = detail.messages.data.map((message) => {
    if (message.id !== messageId) return message;
    changed = true;
    return { ...message, ...patch };
  });
  if (!changed) return detail;
  return { ...detail, messages: { ...detail.messages, data } };
}

/**
 * Apply a fresh conversation snapshot to one cached list (G12: message
 * arrives → patch + reorder, no refetch):
 *
 * - row exists and still matches the list's filters → replace + re-sort
 *   page 1 by (last_message_at, id) DESC (rows on later pages are moved to
 *   page 1 when their sort key moved them forward);
 * - row exists but no longer matches → remove it;
 * - row missing and matches → insert into page 1 + re-sort;
 * - filters not client-evaluable (`q` searches) → patch in place when
 *   present, otherwise leave the list untouched (staleness handles it).
 */
export function listApplyConversation(
  list: ConversationListData,
  item: ConversationListItem,
  filters: ConversationFilters,
): ConversationListData {
  const matches = conversationMatchesFilters(item, filters);

  // Remove every existing occurrence, remembering whether we saw one.
  let existed = false;
  const strippedPages = list.pages.map((page) => {
    if (!page.data.some((row) => row.id === item.id)) return page;
    existed = true;
    return { ...page, data: page.data.filter((row) => row.id !== item.id) };
  });

  if (matches === false) {
    if (!existed) return list;
    return { pages: strippedPages, pageParams: list.pageParams };
  }
  if (matches === null && !existed) {
    // Unevaluable filter and the row was never in this list — don't guess.
    return list;
  }

  const pages = strippedPages.slice();
  const first = pages[0] ?? { data: [], next_cursor: null };
  const data = [item, ...first.data].sort((a, b) =>
    byKeyDesc(a.last_message_at, a.id, b.last_message_at, b.id),
  );
  pages[0] = { ...first, data };
  return { pages, pageParams: list.pageParams };
}

/** Patch a list row in place by id — no re-sort (status/assignee/tags edits). */
export function listPatchConversation(
  list: ConversationListData,
  conversationId: string,
  patch: Partial<ConversationListItem>,
): ConversationListData {
  let changed = false;
  const pages = list.pages.map((page) => {
    const index = page.data.findIndex((row) => row.id === conversationId);
    if (index === -1) return page;
    changed = true;
    const data = page.data.slice();
    data[index] = { ...data[index], ...patch };
    return { ...page, data };
  });
  if (!changed) return list;
  return { pages, pageParams: list.pageParams };
}

/** Flip the per-user unread flag (open-thread /read posts, inbound arrivals). */
export function listSetUnread(
  list: ConversationListData,
  conversationId: string,
  unread: boolean,
): ConversationListData {
  return listPatchConversation(list, conversationId, { unread });
}
