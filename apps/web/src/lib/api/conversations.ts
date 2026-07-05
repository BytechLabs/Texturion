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
  threadUpsertMessages,
  type ConversationListData,
  type ThreadData,
} from "./cache";
import { apiFetch } from "./client";
import {
  normalizeFilters,
  type ConversationFilters,
} from "./filters";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type {
  Conversation,
  ConversationDetail,
  ConversationEvent,
  ConversationListItem,
  ConversationStatus,
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
    onSuccess: (updated) => {
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
    },
  });
}

/** POST /v1/conversations/:id/notes — internal note (amber card, G5). */
export function useCreateNote(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiFetch<Message>(`/v1/conversations/${conversationId}/notes`, {
        method: "POST",
        companyId,
        body: { body },
      }),
    onSuccess: (note) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) => threadUpsertMessages(thread, [{ ...note, attachments: note.attachments ?? [] }]),
      );
      // Notes move thread activity forward (routes/conversations.ts).
      patchConversationLists(queryClient, companyId, (list) =>
        listPatchConversation(list, conversationId, {
          last_message_at: note.created_at,
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
