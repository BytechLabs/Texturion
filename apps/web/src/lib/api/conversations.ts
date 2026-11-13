import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { DeferralKind, WorkPhase } from "@loonext/shared";

import { useActiveCompany, useCompanyId } from "@/lib/company/provider";

import {
  changesSomething,
  findListRow,
  listApplyConversation,
  listPatchConversation,
  listSetUnread,
  pinMutationPatch,
  snippetFromMessage,
  threadUpsertMessages,
  type ConversationListData,
  type ThreadData,
} from "./cache";
import { apiFetch } from "./client";
import {
  conversationMatchesFilters,
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
  MemberThreadState,
  MentionableMember,
  Message,
  MuteDuration,
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
  signal?: AbortSignal,
): Promise<Page<ConversationListItem>> {
  return apiFetch<Page<ConversationListItem>>("/v1/conversations", {
    companyId,
    signal,
    searchParams: {
      status: filters.status,
      assigned_user_id: filters.assigned_user_id,
      tag_id: filters.tag_id,
      is_spam: filters.is_spam,
      unread: filters.unread,
      q: filters.q,
      // #293: omitted means the server's default — the ordinary inbox hides
      // what this member deferred. Only "show me what I deferred" and "show
      // everything" travel.
      snoozed: filters.snoozed,
      // #508: omitted means no filter — the ordinary inbox shows answered and
      // unanswered alike.
      awaiting: filters.awaiting,
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
  signal?: AbortSignal,
): Promise<Page<ConversationListItem>> {
  return apiFetch<Page<ConversationListItem>>("/v1/conversations", {
    companyId,
    signal,
    searchParams: {
      status: filters.status,
      assigned_user_id: filters.assigned_user_id,
      tag_id: filters.tag_id,
      is_spam: filters.is_spam,
      unread: filters.unread,
      q: filters.q,
      // #293: a pin does not outrank a deferral. If I have deferred a pinned
      // thread, it stays deferred — otherwise the one place it is guaranteed
      // to appear is the top of the list I deferred it out of.
      snoozed: filters.snoozed,
      // #508: nor does a pin outrank the question "who is still waiting". A
      // pinned thread that has been answered does not belong in the Unanswered
      // list, at the top or anywhere else.
      awaiting: filters.awaiting,
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

/** The fields a conversation's detail and its list rows both carry. */
type SharedConversationFields = Omit<
  ConversationListItem,
  "contact" | "unread" | "last_message"
>;

/**
 * Write `fields` into every cached copy of one conversation: the detail, each
 * list re-run against its own filters (so a closed row leaves Open and joins
 * Closed), and each pinned supplement. A list that lacks the row gains it from
 * another list's copy, which carries the caller's real `unread`.
 */
function applyConversationFields(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
  fields: Partial<SharedConversationFields>,
): void {
  const known = findListRow(queryClient, companyId, conversationId);
  const detailKey = keys.conversations.detail(companyId, conversationId);
  const detail = queryClient.getQueryData<ConversationDetail>(detailKey);
  if (detail && changesSomething<SharedConversationFields>(detail, fields)) {
    queryClient.setQueryData<ConversationDetail>(detailKey, { ...detail, ...fields });
  }
  patchConversationLists(queryClient, companyId, (list, filters) => {
    const row =
      list.pages.flatMap((page) => page.data).find((r) => r.id === conversationId) ??
      known;
    return row ? listApplyConversation(list, { ...row, ...fields }, filters) : list;
  });
  // The pinned supplement only loses rows here; a new pin needs its refetch.
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: keys.conversations.pinnedRoot(companyId),
  })) {
    const data = query.state.data as Page<ConversationListItem> | undefined;
    const row = data?.data.find((r) => r.id === conversationId);
    if (!data || !row || !changesSomething(row, fields)) continue;
    const next = { ...row, ...fields };
    const stays =
      next.pinned_at !== null &&
      conversationMatchesFilters(next, filtersFromListKey(query.queryKey)) !== false;
    queryClient.setQueryData<Page<ConversationListItem>>(query.queryKey, {
      ...data,
      data: stays
        ? data.data.map((r) => (r.id === conversationId ? next : r))
        : data.data.filter((r) => r.id !== conversationId),
    });
  }
}

/**
 * Stop the in-flight reads under `roots`, so a response that left before a
 * write cannot land over its optimistic row. Returns the keys it stopped, to
 * fetch again once the write has landed.
 */
async function stopReads(
  queryClient: QueryClient,
  roots: readonly QueryKey[],
): Promise<QueryKey[]> {
  const cache = queryClient.getQueryCache();
  const stopped = roots.flatMap((queryKey) =>
    cache.findAll({ queryKey, fetchStatus: "fetching" }).map((query) => query.queryKey),
  );
  await Promise.all(roots.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  return stopped;
}

/** Refetch what an optimistic write may have shown wrongly, from the server. */
function reconcileConversation(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
): void {
  for (const queryKey of [
    keys.conversations.detail(companyId, conversationId),
    keys.conversations.lists(companyId),
    keys.conversations.pinnedRoot(companyId),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type ConversationPages = InfiniteData<Page<ConversationListItem>, string | undefined>;

/**
 * The rows of the cached unfiltered inbox that also belong under `filters`, to
 * show while the filtered list loads. Undefined for a search, the spam view
 * and the deferred views: the unfiltered list never holds those rows.
 */
export function placeholderFromAllList(
  queryClient: QueryClient,
  companyId: string,
  filters: ConversationFilters,
): ConversationPages | undefined {
  if (filters.q !== undefined || filters.is_spam === true || filters.snoozed !== undefined) {
    return undefined;
  }
  const all = queryClient.getQueryData<ConversationListData>(
    keys.conversations.list(companyId, normalizeFilters({})),
  );
  const data = (all?.pages ?? [])
    .flatMap((page) => page.data)
    .filter((row) => conversationMatchesFilters(row, filters) === true);
  if (data.length === 0) return undefined;
  return { pages: [{ data, next_cursor: null }], pageParams: [undefined] };
}

/** Inbox list — infinite cursor pagination with URL-driven filters (G3/G4). */
export function useConversations(
  filters: ConversationFilters = {},
  options: { placeholderFromAll?: boolean } = {},
) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const normalized = normalizeFilters(filters);
  return useInfiniteQuery({
    queryKey: keys.conversations.list(companyId, normalized),
    queryFn: ({ pageParam, signal }) =>
      fetchConversationPage(companyId, normalized, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    placeholderData: options.placeholderFromAll
      ? () => placeholderFromAllList(queryClient, companyId, normalized)
      : undefined,
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
    queryFn: ({ signal }) => fetchPinnedConversations(companyId, normalized, signal),
    // The previous view's pins, less the ones these filters rule out.
    placeholderData: (previous) =>
      previous && {
        ...previous,
        data: previous.data.filter(
          (row) => conversationMatchesFilters(row, normalized) !== false,
        ),
      },
  });
}

/**
 * The detail read, shared by the thread and by prefetch. It takes no abort
 * signal: a thread closed mid-fetch is often reopened, and its answer is kept.
 */
export function conversationDetailOptions(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
) {
  return queryOptions({
    queryKey: keys.conversations.detail(companyId, conversationId),
    queryFn: async () => {
      const detail = await fetchConversationDetail(companyId, conversationId);
      seedThreadFromDetail(queryClient, companyId, detail);
      return detail;
    },
  });
}

/** Thread header + contact panel + embedded first message page. */
export function useConversation(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useQuery(conversationDetailOptions(queryClient, companyId, conversationId));
}

const PREFETCH_STALE_MS = 30_000;

/**
 * Warm a thread the pointer or focus is about to open. Only the detail read:
 * POST /read and attachment URLs wait for the open itself.
 */
export function usePrefetchConversation() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useCallback(
    (conversationId: string) =>
      queryClient.prefetchQuery({
        ...conversationDetailOptions(queryClient, companyId, conversationId),
        staleTime: PREFETCH_STALE_MS,
      }),
    [queryClient, companyId],
  );
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
  /**
   * #250: "this is not spam" against the CLASSIFIER, which is a different
   * sentence from is_spam:false against a person's own mark. Only literal
   * false has meaning — nothing may set a suspicion from outside, or it
   * stops being the machine's own opinion.
   */
  spam_suspected?: false;
  /**
   * #301: where this customer came from, as a person answered it. Null CLEARS
   * it back to unknown rather than falling back to the line's source — a tech
   * who picked the wrong chip needs to be able to say "actually I don't know".
   */
  lead_source_id?: string | null;
}

/**
 * What a PATCH writes, as routes/conversations.ts writes it, so the optimistic
 * row and the server row agree. Lead source and the spam review answers are
 * left to the server.
 */
function optimisticConversationFields(
  current: Pick<
    Conversation,
    "status" | "closed_at" | "is_spam" | "assigned_user_id" | "pinned_at"
  >,
  patch: ConversationPatch,
  userId: string,
  now: Date = new Date(),
): Partial<Conversation> {
  const fields: Partial<Conversation> = {};
  if (patch.status !== undefined && patch.status !== current.status) {
    fields.status = patch.status;
    fields.closed_at = patch.status === "closed" ? now.toISOString() : null;
  }
  if (patch.is_spam !== undefined && patch.is_spam !== current.is_spam) {
    fields.is_spam = patch.is_spam;
    // Marking spam also closes the thread; un-marking leaves it closed.
    if (patch.is_spam) {
      fields.status = "closed";
      fields.closed_at = current.closed_at ?? now.toISOString();
    }
  }
  if (
    patch.assigned_user_id !== undefined &&
    patch.assigned_user_id !== current.assigned_user_id
  ) {
    fields.assigned_user_id = patch.assigned_user_id;
  }
  if (patch.pinned !== undefined && patch.pinned !== (current.pinned_at !== null)) {
    Object.assign(fields, pinMutationPatch(patch.pinned, userId, now));
  }
  return fields;
}

interface ConversationPatchContext {
  stopped: QueryKey[];
}

/**
 * PATCH /v1/conversations/:id, optimistic (docs/APP-UI-ELEVATION.md §4): the
 * row changes at the click and a refusal refetches the truth. Every edit of
 * one conversation shares a scope, so a close and its Undo reach the server
 * in the order they were made.
 */
function conversationPatchOptions(
  queryClient: QueryClient,
  companyId: string,
  userId: string,
  conversationId: string,
): UseMutationOptions<Conversation, Error, ConversationPatch, ConversationPatchContext> {
  const scopeId = `conversation:${conversationId}`;
  const detailKey = keys.conversations.detail(companyId, conversationId);
  return {
    scope: { id: scopeId },
    mutationFn: (patch) =>
      apiFetch<Conversation>(`/v1/conversations/${conversationId}`, {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onMutate: async (patch) => {
      const stopped = await stopReads(queryClient, [
        detailKey,
        keys.conversations.lists(companyId),
        keys.conversations.pinnedRoot(companyId),
      ]);
      const current =
        queryClient.getQueryData<ConversationDetail>(detailKey) ??
        findListRow(queryClient, companyId, conversationId);
      if (current) {
        const fields = optimisticConversationFields(current, patch, userId);
        if (Object.keys(fields).length > 0) {
          applyConversationFields(queryClient, companyId, conversationId, fields);
        }
      }
      return { stopped };
    },
    onError: () => reconcileConversation(queryClient, companyId, conversationId),
    onSuccess: (updated, patch, context) => {
      // #13: a new pin has to be inserted into the pinned supplement, and an
      // unpin refetches too so a quick pin-then-unpin ends on the server's set.
      if (patch.pinned !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: keys.conversations.pinnedRoot(companyId),
          refetchType: "active",
        });
      }
      // #342: either answer to the review prompt removes the row from the
      // strip, and the server decides which rows remain — refetch rather than
      // guess at the ranking here.
      if (patch.is_spam !== undefined || patch.spam_reviewed !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: keys.spamReview(companyId),
          refetchType: "active",
        });
      }
      // A later edit of this conversation is already on screen; this older
      // row would put the earlier state back until that edit lands.
      const superseded =
        queryClient.isMutating({
          predicate: (mutation) => mutation.options.scope?.id === scopeId,
        }) > 1;
      if (!superseded) {
        applyConversationFields(queryClient, companyId, conversationId, updated);
      }
      for (const queryKey of context.stopped) {
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
      }
      // The events timeline gained rows server-side.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  };
}

/** PATCH /v1/conversations/:id: status, assignee, spam, pin. */
export function useUpdateConversation(conversationId: string) {
  const { companyId, userId } = useActiveCompany();
  const queryClient = useQueryClient();
  return useMutation(
    conversationPatchOptions(queryClient, companyId, userId, conversationId),
  );
}

export interface ConversationPatchCallbacks {
  onSuccess?: (updated: Conversation) => void;
  onError?: (error: Error) => void;
}

/**
 * The same optimistic PATCH as `useUpdateConversation`, for a surface that
 * acts on whichever row has focus (the inbox `e` key), so the conversation is
 * named per call. It shares that hook's per-conversation order.
 */
export function useConversationPatch() {
  const { companyId, userId } = useActiveCompany();
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      mutate: (
        { id, patch }: { id: string; patch: ConversationPatch },
        callbacks: ConversationPatchCallbacks = {},
      ) => {
        void queryClient
          .getMutationCache()
          .build(queryClient, conversationPatchOptions(queryClient, companyId, userId, id))
          .execute(patch)
          .then(callbacks.onSuccess, (error: Error) => callbacks.onError?.(error));
      },
    }),
    [queryClient, companyId, userId],
  );
}

/** The newest read receipt this tab got back, per conversation. */
const readReceipts = new Map<string, ReadReceipt>();

/**
 * Up to when `userId` has already marked the conversation read from this tab,
 * so an open that shows nothing newer can skip POST /read. Undefined once it is
 * marked unread here, and for whoever signs in to this tab next.
 */
export function readCoveredThrough(
  conversationId: string,
  userId: string,
): string | undefined {
  const receipt = readReceipts.get(conversationId);
  return receipt?.user_id === userId ? receipt.last_read_at : undefined;
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
      let found = false;
      let flipped = false;
      // The unread dot clears instantly; the server upsert follows.
      patchConversationLists(queryClient, companyId, (list) => {
        const row = list.pages
          .flatMap((page) => page.data)
          .find((r) => r.id === conversationId);
        if (!row) return list;
        found = true;
        flipped ||= row.unread;
        return listSetUnread(list, conversationId, false);
      });
      // The pinned supplement renders its own copy of the row.
      patchPinnedConversations(queryClient, companyId, (row) => {
        if (row.id !== conversationId) return row;
        found = true;
        if (!row.unread) return row;
        flipped = true;
        return { ...row, unread: false };
      });
      // With no cached row there is no telling whether the queue counted it.
      return { queueMayChange: flipped || !found };
    },
    onSuccess: (receipt, conversationId, context) => {
      if (receipt?.last_read_at) {
        const previous = readCoveredThrough(conversationId, receipt.user_id);
        if (!previous || Date.parse(receipt.last_read_at) > Date.parse(previous)) {
          readReceipts.set(conversationId, receipt);
        }
      }
      if (context.queueMayChange) {
        void queryClient.invalidateQueries({
          queryKey: keys.forYou(companyId),
          refetchType: "active",
        });
      }
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
      readReceipts.delete(conversationId);
      // The dot returns instantly; the server delete follows.
      patchConversationLists(queryClient, companyId, (list) =>
        listSetUnread(list, conversationId, true),
      );
      // The pinned supplement renders its own copy of the row.
      patchPinnedConversations(queryClient, companyId, (row) =>
        row.id === conversationId && !row.unread ? { ...row, unread: true } : row,
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

/**
 * #293 — deferral. "Needs attention, but on Thursday."
 *
 * Both mutations move the row rather than invalidating: a thread deferred from
 * the inbox has to leave the list under the hand that deferred it, and the same
 * row has to appear in the Snoozed view if that view is open in another tab of
 * the same session. `listApplyConversation` re-runs each cached list's own
 * filters against the patched row, so one patch does both.
 */
function applySnoozeToCaches(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
  patch: Pick<
    ConversationListItem,
    "snoozed_until" | "snooze_note" | "snooze_kind"
  >,
): void {
  patchConversationLists(queryClient, companyId, (list, filters) => {
    const existing = list.pages
      .flatMap((page) => page.data)
      .find((row) => row.id === conversationId);
    if (!existing) return list;
    return listApplyConversation(list, { ...existing, ...patch }, filters);
  });
  patchPinnedConversations(queryClient, companyId, (row) =>
    row.id === conversationId ? { ...row, ...patch } : row,
  );
  // The thread header reads the same two fields, so it flips with the list.
  queryClient.setQueryData<ConversationDetail>(
    keys.conversations.detail(companyId, conversationId),
    (detail) => (detail ? { ...detail, ...patch } : detail),
  );
}

export interface SnoozeConversationInput {
  conversationId: string;
  /** The absolute instant it comes back, resolved in the user's own clock. */
  until: string;
  /** #293: 'snooze' returns it quietly; 'follow_up' returns it to be chased. */
  kind?: DeferralKind;
  note?: string;
}

/** POST /v1/conversations/:id/snooze — defer it out of MY list until `until`. */
export function useSnoozeConversation() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      until,
      kind,
      note,
    }: SnoozeConversationInput) =>
      apiFetch<{ until: string; note: string | null }>(
        `/v1/conversations/${conversationId}/snooze`,
        { method: "POST", companyId, body: { until, kind, note } },
      ),
    onMutate: ({ conversationId, until, kind, note }) => {
      applySnoozeToCaches(queryClient, companyId, conversationId, {
        snoozed_until: until,
        snooze_note: note ?? null,
        snooze_kind: kind ?? "snooze",
      });
    },
    onError: () => {
      // The row was optimistically removed from the inbox. If the write did not
      // land, leaving it removed hides a live thread — the exact failure this
      // feature must never cause — so reconcile from the server rather than
      // trusting a snapshot.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.pinnedRoot(companyId),
      });
    },
  });
}

/** DELETE /v1/conversations/:id/snooze — bring it back now, in one tap. */
export function useUnsnoozeConversation() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<void>(`/v1/conversations/${conversationId}/snooze`, {
        method: "DELETE",
        companyId,
      }),
    onMutate: (conversationId) => {
      applySnoozeToCaches(queryClient, companyId, conversationId, {
        snoozed_until: null,
        snooze_note: null,
        snooze_kind: null,
      });
    },
    onError: () => {
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
 * #694: mute and follow. Both are the caller's own state, so the response is
 * written straight into the list and the thread header; no other member's view
 * changes, and nothing is invalidated.
 */
function applyMemberStateToCaches(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
  patch: MemberThreadState,
): void {
  patchConversationLists(queryClient, companyId, (list) => ({
    ...list,
    pages: list.pages.map((page) => ({
      ...page,
      data: page.data.map((row) =>
        row.id === conversationId ? { ...row, ...patch } : row,
      ),
    })),
  }));
  patchPinnedConversations(queryClient, companyId, (row) =>
    row.id === conversationId ? { ...row, ...patch } : row,
  );
  queryClient.setQueryData<ConversationDetail>(
    keys.conversations.detail(companyId, conversationId),
    (detail) => (detail ? { ...detail, ...patch } : detail),
  );
}

function useMemberStateMutation<Input extends { conversationId: string }>(
  request: (input: Input, companyId: string) => Promise<MemberThreadState>,
) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => request(input, companyId),
    onSuccess: (state, input) =>
      applyMemberStateToCaches(queryClient, companyId, input.conversationId, state),
  });
}

/** PUT /v1/conversations/:id/mute: silence this thread for ME. */
export function useMuteConversation() {
  return useMemberStateMutation(
    ({ conversationId, duration }: { conversationId: string; duration: MuteDuration }, companyId) =>
      apiFetch<MemberThreadState>(`/v1/conversations/${conversationId}/mute`, {
        method: "PUT",
        companyId,
        body: { duration },
      }),
  );
}

/** DELETE /v1/conversations/:id/mute */
export function useUnmuteConversation() {
  return useMemberStateMutation(
    ({ conversationId }: { conversationId: string }, companyId) =>
      apiFetch<MemberThreadState>(`/v1/conversations/${conversationId}/mute`, {
        method: "DELETE",
        companyId,
      }),
  );
}

/** PUT / DELETE /v1/conversations/:id/follow */
export function useFollowConversation() {
  return useMemberStateMutation(
    ({ conversationId, follow }: { conversationId: string; follow: boolean }, companyId) =>
      apiFetch<MemberThreadState>(`/v1/conversations/${conversationId}/follow`, {
        method: follow ? "PUT" : "DELETE",
        companyId,
      }),
  );
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
    mutationFn: (
      input:
        | string
        | {
            body: string;
            mentionUserIds?: string[];
            /** #294: before or after, for the photos arriving on this note. */
            workPhase?: WorkPhase | null;
          },
    ) => {
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
          // Same rule: absent means "neither", which is most notes.
          ...(draft.workPhase ? { work_phase: draft.workPhase } : {}),
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

/**
 * Write one tag change into every cached copy of the conversation, computed
 * from the copy the thread shows. False when no copy is cached.
 */
function applyTagChange(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
  change: (tags: Tag[]) => Tag[],
): boolean {
  const tags =
    queryClient.getQueryData<ConversationDetail>(
      keys.conversations.detail(companyId, conversationId),
    )?.tags ?? findListRow(queryClient, companyId, conversationId)?.tags;
  if (!tags) return false;
  applyConversationFields(queryClient, companyId, conversationId, {
    tags: change(tags),
  });
  return true;
}

const withTag = (tag: Tag) => (tags: Tag[]) =>
  tags.some((t) => t.id === tag.id) ? tags : [...tags, tag];
const withoutTag = (tagId: string) => (tags: Tag[]) =>
  tags.some((t) => t.id === tagId) ? tags.filter((t) => t.id !== tagId) : tags;

/**
 * POST /v1/conversations/:id/tags — `{ tag_id }` or `{ name }` (create-on-attach).
 * A known tag shows at the click; a new name waits for the server to mint it.
 */
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
    onMutate: (input) => {
      const known =
        "tag_id" in input
          ? queryClient
              .getQueryData<Page<Tag>>(keys.tags(companyId))
              ?.data.find((t) => t.id === input.tag_id)
          : undefined;
      return {
        optimistic:
          known !== undefined &&
          applyTagChange(queryClient, companyId, conversationId, withTag(known)),
      };
    },
    onError: (_error, _input, context) => {
      if (context?.optimistic) {
        reconcileConversation(queryClient, companyId, conversationId);
      }
    },
    onSuccess: (tag) => {
      applyTagChange(queryClient, companyId, conversationId, withTag(tag));
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

/** DELETE /v1/conversations/:id/tags/:tag_id. The chip goes at the click. */
export function useDetachTag(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/v1/conversations/${conversationId}/tags/${tagId}`, {
        method: "DELETE",
        companyId,
      }),
    onMutate: (tagId) => {
      applyTagChange(queryClient, companyId, conversationId, withoutTag(tagId));
    },
    onError: () => reconcileConversation(queryClient, companyId, conversationId),
    onSuccess: (_void, tagId) => {
      applyTagChange(queryClient, companyId, conversationId, withoutTag(tagId));
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

/**
 * #431 — report what a human did with one piece of AI output.
 *
 * Fire-and-forget on purpose: a failure here must never surface to the person
 * sending a text. Losing an outcome costs a data point; failing a send costs a job.
 * So this swallows its errors and is deliberately NOT a mutation hook — nothing in
 * the UI should ever wait on it, retry it, or show a state for it.
 *
 * Enum only. The server never learns what the draft said or what the human typed
 * instead, which is both the privacy posture and the entire measurement.
 */
export type AiOutcome = "used" | "edited" | "discarded";
/**
 * The LEDGER keys, not friendlier names. The outcome lands on the same row the
 * spend does, so "enrich_task" — which reads better than the ledger's "enrich" —
 * would open a second row and separate cost from value permanently.
 */
export type AiOutcomeFeature =
  | "suggest_reply"
  | "enrich"
  | "voicemail_transcript"
  // #507: the crew member's dictated wrap-up. It is here — and the voicemail
  // transcript above it reports nothing from a client — for one reason: this
  // one is HANDED OVER for review, so what a person did with it is visible.
  // That is the argument for returning text instead of posting the note.
  | "call_wrapup"
  // #247: the thread catch-up. Only "used" is ever reported for it, and only
  // when somebody opens a cited message — the one deliberate act a client can
  // see. "Read it and got on with the job" is a person NOT doing something, and
  // three clients inventing three scroll heuristics for it would produce a
  // number nobody could interpret. See THREAD_SUMMARY_FEATURE_SPEC.outcomes.
  | "thread_summary";

export function reportAiOutcome(
  companyId: string,
  feature: AiOutcomeFeature,
  outcome: AiOutcome,
): void {
  void apiFetch("/v1/ai/outcome", {
    method: "POST",
    companyId,
    body: { feature, outcome },
  }).catch(() => {
    // Intentionally silent. See above.
  });
}
