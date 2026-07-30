import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import {
  listApplyConversation,
  listPatchConversation,
  listSetUnread,
  snippetFromMessage,
  threadUpsertMessages,
  type ConversationListData,
  type ThreadData,
} from "./cache";
import { apiFetch } from "./client";
import {
  normalizeFilters,
  type ConversationFilters,
} from "./filters";
import type {
  BulkConversationsBody,
  BulkConversationsResult,
} from "@/lib/inbox/bulk-selection";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type {
  Conversation,
  ConversationDetail,
  ConversationEvent,
  ConversationListItem,
  ConversationStatus,
  MentionableMember,
  Message,
  Page,
  ReadReceipt,
  Tag,
} from "./types";

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export function fetchConversationPage(
  companyId: string,
  filters: ConversationFilters,
  cursor?: string,
): Promise<Page<ConversationListItem>> {
  return apiFetch<Page<ConversationListItem>>("/v1/conversations", {
    companyId,
    searchParams: {
      status: filters.status,
      assigned_user_id: filters.assigned_user_id,
      tag_id: filters.tag_id,
      is_spam: filters.is_spam,
      unread: filters.unread,
      q: filters.q,
      cursor,
    },
  });
}

/**
 * #13: the company's pinned conversations for the current filters, in ONE call
 * (server-ordered pinned_at desc). A supplement to the main list so a pinned
 * thread that has scrolled past the loaded pages still shows at the top — the
 * main list + its keyset cursor are untouched. Pins are few, so one page (100)
 * is ample.
 */
export function fetchPinnedConversations(
  companyId: string,
  filters: ConversationFilters,
): Promise<Page<ConversationListItem>> {
  return apiFetch<Page<ConversationListItem>>("/v1/conversations", {
    companyId,
    searchParams: {
      status: filters.status,
      assigned_user_id: filters.assigned_user_id,
      tag_id: filters.tag_id,
      is_spam: filters.is_spam,
      unread: filters.unread,
      q: filters.q,
      pinned: "only",
      limit: "100",
    },
  });
}

export function fetchConversationDetail(
  companyId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/v1/conversations/${conversationId}`, {
    companyId,
  });
}

// ---------------------------------------------------------------------------
// Cache helpers shared with the realtime provider
// ---------------------------------------------------------------------------

/** Extract the filter object back out of a conversation-list query key. */
export function filtersFromListKey(
  queryKey: readonly unknown[],
): ConversationFilters {
  return (queryKey[3] ?? {}) as ConversationFilters;
}

/**
 * Apply `reduce` to every row of every cached PINNED supplement (#13).
 *
 * The pinned query is a separate cache entry under its own key, and the inbox
 * renders pinned rows from IT while filtering those ids out of the main list.
 * So a mutation that only patched the main list changed the row that is not on
 * screen: marking a pinned thread read cleared a dot nobody could see, while
 * the visible pinned row kept its own.
 *
 * A plain page, not the infinite shape the list reducers take, so it has its
 * own walker rather than sharing theirs.
 */
export function patchPinnedConversations(
  queryClient: QueryClient,
  companyId: string,
  reduce: (row: ConversationListItem) => ConversationListItem,
): void {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: keys.conversations.pinnedRoot(companyId),
  });
  for (const query of queries) {
    const data = query.state.data as Page<ConversationListItem> | undefined;
    if (!data) continue;
    let changed = false;
    const rows = data.data.map((row) => {
      const next = reduce(row);
      if (next !== row) changed = true;
      return next;
    });
    if (changed) queryClient.setQueryData(query.queryKey, { ...data, data: rows });
  }
}

/**
 * Iterate every cached conversation list (any filter combination) and apply
 * `reduce` with that list's own filters. The core primitive behind mutation
 * and realtime cache patching.
 */
export function patchConversationLists(
  queryClient: QueryClient,
  companyId: string,
  reduce: (
    list: ConversationListData,
    filters: ConversationFilters,
  ) => ConversationListData,
): void {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: keys.conversations.lists(companyId),
  });
  for (const query of queries) {
    const data = query.state.data as ConversationListData | undefined;
    if (!data) continue;
    const next = reduce(data, filtersFromListKey(query.queryKey));
    if (next !== data) {
      queryClient.setQueryData(query.queryKey, next);
    }
  }
}

/**
 * Seed the thread cache from a detail response's embedded first page so the
 * thread renders instantly without a second fetch (SPEC §7 embedded page).
 */
export function seedThreadFromDetail(
  queryClient: QueryClient,
  companyId: string,
  detail: ConversationDetail,
): void {
  const threadKey = keys.thread(companyId, detail.id);
  const existing = queryClient.getQueryData<ThreadData>(threadKey);
  if (existing) {
    queryClient.setQueryData<ThreadData>(
      threadKey,
      threadUpsertMessages(existing, detail.messages.data),
    );
    return;
  }
  queryClient.setQueryData<ThreadData>(threadKey, {
    pages: [detail.messages],
    pageParams: [undefined],
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Inbox list — infinite cursor pagination with URL-driven filters (G3/G4). */
export function useConversations(filters: ConversationFilters = {}) {
  const companyId = useCompanyId();
  const normalized = normalizeFilters(filters);
  return useInfiniteQuery({
    queryKey: keys.conversations.list(companyId, normalized),
    queryFn: ({ pageParam }) =>
      fetchConversationPage(companyId, normalized, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
}

/**
 * #13 pinned-first supplement: the complete, server-ordered pinned set for the
 * current filters. Rendered above the main list so far-horizon pins always show
 * at the top; the main `useConversations` query (and its realtime/cache path)
 * is unchanged.
 */
export function usePinnedConversations(filters: ConversationFilters = {}) {
  const companyId = useCompanyId();
  const normalized = normalizeFilters(filters);
  return useQuery({
    queryKey: keys.conversations.pinned(companyId, normalized),
    queryFn: () => fetchPinnedConversations(companyId, normalized),
  });
}

/** Thread header + contact panel + embedded first message page. */
export function useConversation(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.conversations.detail(companyId, conversationId),
    queryFn: async () => {
      const detail = await fetchConversationDetail(companyId, conversationId);
      seedThreadFromDetail(queryClient, companyId, detail);
      return detail;
    },
  });
}

/** Audit timeline (status/assign/tag/opt-out lines — G5). */
export function useConversationEvents(conversationId: string) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.conversations.events(companyId, conversationId),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<ConversationEvent>>(
        `/v1/conversations/${conversationId}/events`,
        { companyId, searchParams: { cursor: pageParam } },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
}

// ---------------------------------------------------------------------------
// Mutations — precise cache updates, no refetch storms (G12)
// ---------------------------------------------------------------------------

export interface ConversationPatch {
  status?: ConversationStatus;
  assigned_user_id?: string | null;
  is_spam?: boolean;
  /** #3: pin/unpin the whole conversation (top of the inbox). */
  pinned?: boolean;
  /**
   * #342: "yes, this is still spam" — answers the review prompt without
   * lifting the mark. Only literal true has meaning.
   */
  spam_reviewed?: true;
}

/** PATCH /v1/conversations/:id — status / assignee / spam. */
export function useUpdateConversation(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ConversationPatch) =>
      apiFetch<Conversation>(`/v1/conversations/${conversationId}`, {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onSuccess: (updated, patch) => {
      // #13: a pin toggle moves the thread in/out of the pinned supplement —
      // refetch it so the top section reflects the change immediately.
      if (patch.pinned !== undefined) {
        queryClient.invalidateQueries({
          queryKey: keys.conversations.pinnedRoot(companyId),
          refetchType: "active",
        });
      }
      // #342: either answer to the review prompt removes the row from the
      // strip, and the server decides which rows remain — refetch rather than
      // guess at the ranking here.
      if (patch.is_spam !== undefined || patch.spam_reviewed !== undefined) {
        queryClient.invalidateQueries({
          queryKey: keys.spamReview(companyId),
          refetchType: "active",
        });
      }
      // Detail: merge the fresh conversation fields, keep contact/tags/messages.
      queryClient.setQueryData<ConversationDetail>(
        keys.conversations.detail(companyId, conversationId),
        (detail) => (detail ? { ...detail, ...updated } : detail),
      );
      // Lists: re-evaluate each list's filters with the updated row (a closed
      // conversation leaves the "Open" segment immediately).
      patchConversationLists(queryClient, companyId, (list, filters) => {
        const existing = list.pages
          .flatMap((page) => page.data)
          .find((row) => row.id === conversationId);
        if (!existing) return list;
        return listApplyConversation(list, { ...existing, ...updated }, filters);
      });
      // The events timeline gained rows server-side.
      queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/conversations/:id/read — opening a thread marks it read (G4). */
export function useMarkConversationRead() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<ReadReceipt>(`/v1/conversations/${conversationId}/read`, {
        method: "POST",
        companyId,
      }),
    onMutate: (conversationId) => {
      // The unread dot clears instantly; the server upsert follows.
      patchConversationLists(queryClient, companyId, (list) =>
        listSetUnread(list, conversationId, false),
      );
      // The pinned supplement renders its own copy of the row.
      patchPinnedConversations(queryClient, companyId, (row) =>
        row.id === conversationId ? { ...row, unread: false } : row,
      );
    },
    onError: () => {
      // The optimistic unread-clear didn't reach the server — reconcile the
      // badges from the source of truth so a failed read doesn't leave a thread
      // permanently showing as read. (A snapshot restore would wrongly re-mark
      // a thread that was already read; a refetch reflects the true state.)
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.pinnedRoot(companyId),
      });
    },
  });
}

/**
 * DELETE /v1/conversations/:id/read — put a thread back in the unread pile.
 * Both phone apps have had this as an inbox swipe since #185; on web, opening
 * a thread to glance at it marked it read with no way to undo, so a message
 * you meant to come back to lost the only mark that said so.
 */
export function useMarkConversationUnread() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<ReadReceipt>(`/v1/conversations/${conversationId}/read`, {
        method: "DELETE",
        companyId,
      }),
    onMutate: (conversationId) => {
      // The dot returns instantly; the server delete follows.
      patchConversationLists(queryClient, companyId, (list) =>
        listSetUnread(list, conversationId, true),
      );
      // The pinned supplement renders its own copy of the row.
      patchPinnedConversations(queryClient, companyId, (row) =>
        row.id === conversationId ? { ...row, unread: true } : row,
      );
    },
    onError: () => {
      // Same reasoning as the read path: refetch rather than restore, so the
      // badges come back from the source of truth.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.pinnedRoot(companyId),
      });
    },
  });
}

/** POST /v1/conversations/:id/notes — internal note (amber card, G5). */
/**
 * Teammates this member may name on a note here.
 *
 * Its own endpoint rather than a filter over GET /v1/members: the client cannot
 * see number access, so a client-side filter would offer people the server is
 * going to reject. Fetched only while the picker is open.
 */
export function useMentionableMembers(conversationId: string, enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.mentionableMembers(companyId, conversationId),
    queryFn: () =>
      apiFetch<Page<MentionableMember>>(
        `/v1/conversations/${conversationId}/mentionable-members`,
        { companyId },
      ),
    enabled,
  });
}

export function useCreateNote(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { body: string; mentionUserIds?: string[] }) => {
      const draft = typeof input === "string" ? { body: input } : input;
      return apiFetch<Message>(`/v1/conversations/${conversationId}/notes`, {
        method: "POST",
        companyId,
        body: {
          body: draft.body,
          // Omitted rather than sent empty: the server treats an absent list
          // as "no mentions", and an older server ignores the field entirely.
          ...(draft.mentionUserIds?.length
            ? { mention_user_ids: draft.mentionUserIds }
            : {}),
        },
      });
    },
    onSuccess: (note) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) => threadUpsertMessages(thread, [{ ...note, attachments: note.attachments ?? [] }]),
      );
      // Notes move thread activity forward (routes/conversations.ts) and are
      // the newest thread line — patch the inbox preview too (#55), so the list
      // snippet stays correct even when realtime is down.
      patchConversationLists(queryClient, companyId, (list) =>
        listPatchConversation(list, conversationId, {
          last_message_at: note.created_at,
          last_message: snippetFromMessage(note),
        }),
      );
    },
  });
}

/** POST /v1/conversations/:id/tags — `{ tag_id }` or `{ name }` (create-on-attach). */
export function useAttachTag(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { tag_id: string } | { name: string }) =>
      apiFetch<Tag>(`/v1/conversations/${conversationId}/tags`, {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (tag) => {
      const addTag = (tags: Tag[]): Tag[] =>
        tags.some((t) => t.id === tag.id) ? tags : [...tags, tag];
      queryClient.setQueryData<ConversationDetail>(
        keys.conversations.detail(companyId, conversationId),
        (detail) =>
          detail ? { ...detail, tags: addTag(detail.tags) } : detail,
      );
      patchConversationLists(queryClient, companyId, (list) => {
        const row = list.pages
          .flatMap((page) => page.data)
          .find((r) => r.id === conversationId);
        if (!row) return list;
        return listPatchConversation(list, conversationId, {
          tags: addTag(row.tags),
        });
      });
      // Create-on-attach may have minted a new tag for the company.
      queryClient.setQueryData<Page<Tag>>(keys.tags(companyId), (page) =>
        page && !page.data.some((t) => t.id === tag.id)
          ? { ...page, data: [...page.data, tag] }
          : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  });
}

/** DELETE /v1/conversations/:id/tags/:tag_id */
export function useDetachTag(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/v1/conversations/${conversationId}/tags/${tagId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (_void, tagId) => {
      const dropTag = (tags: Tag[]) => tags.filter((t) => t.id !== tagId);
      queryClient.setQueryData<ConversationDetail>(
        keys.conversations.detail(companyId, conversationId),
        (detail) =>
          detail ? { ...detail, tags: dropTag(detail.tags) } : detail,
      );
      patchConversationLists(queryClient, companyId, (list) => {
        const row = list.pages
          .flatMap((page) => page.data)
          .find((r) => r.id === conversationId);
        if (!row) return list;
        return listPatchConversation(list, conversationId, {
          tags: dropTag(row.tags),
        });
      });
      queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  });
}

/**
 * #275 — one bulk action over a selection, plus the undo it comes back with.
 *
 * The server decides scope: send `ids` for a pointed-at selection, or omit them
 * and send the `filter` so it resolves the set itself under the #106 deny list.
 * The client never enumerates "everything matching" — see
 * `lib/inbox/bulk-selection.ts` for why that distinction is load-bearing.
 *
 * The response carries `applied[].previous`, which is what makes ONE undo for the
 * whole batch possible (docs/UNDO-AUDIT.md §4): reverting means replaying those
 * exact rows back to those exact values, never "reopen everything closed in the
 * last minute" — which would also revert a teammate's concurrent work.
 *
 * Every list is invalidated rather than patched. A bulk action can move hundreds
 * of rows across filters at once, and hand-reconciling that in the cache is how a
 * list ends up showing a thread the server no longer puts there.
 */
export function useBulkConversations() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkConversationsBody) =>
      apiFetch<BulkConversationsResult>("/v1/conversations/bulk", {
        method: "POST",
        companyId,
        body,
      }),
    onSuccess: () => {
      // Everything: lists, the pinned supplement, the spam strip, and the unread
      // badge can all move in one call.
      queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.conversations.pinnedRoot(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.spamReview(companyId),
        refetchType: "active",
      });
    },
  });
}
