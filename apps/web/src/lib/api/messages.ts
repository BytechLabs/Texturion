import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MmsMediaType } from "@loonext/shared";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useT } from "@/i18n/provider";
import { THREAD_MESSAGE_PARAM } from "@/lib/inbox/thread-href";
import { useCompanyId } from "@/lib/company/provider";

import {
  detailPatchMessage,
  doneMutationPatch,
  pinMutationPatch,
  snippetFromMessage,
  detailInversePatch,
  threadInversePatch,
  threadPatchMessage,
  threadUpsertMessages,
  type ThreadData,
} from "./cache";
import { toast } from "sonner";

import { apiFetch } from "./client";
import { ApiError } from "./error";
import { listApplyConversation } from "./cache";
import { patchConversationLists } from "./conversations";
import { keys } from "./keys";
import type {
  ConversationDetail,
  ConversationListItem,
  Me,
  Message,
  MessagesPage,
  Page,
} from "./types";

/**
 * Outbound media item (SPEC §7, widened by #189): ≤3 items, ≤1 MB decoded,
 * any type in the shared deliverable set (images, audio, video, vCard,
 * calendar, PDF, text) — @loonext/shared is the one contract the API
 * enforces and the composers validate against.
 */
export interface OutboundMedia {
  content_type: MmsMediaType;
  base64: string;
}

export function fetchMessagesPage(
  companyId: string,
  conversationId: string,
  cursor?: string,
  limit?: number,
): Promise<Page<Message>> {
  return apiFetch<Page<Message>>(
    `/v1/conversations/${conversationId}/messages`,
    { companyId, searchParams: { cursor, limit } },
  );
}

/**
 * What one page of a thread was asked for. `undefined` is the newest page.
 * `around` opens at a message (#718), `direction: "newer"` pages toward the
 * newest, a bare `cursor` pages toward the oldest.
 */
export interface MessagesParam {
  cursor?: string;
  direction?: "newer";
  around?: string;
}

/** The URL params one thread page is fetched with, in one place so a test can pin them. */
export function messagesSearchParams(
  param: MessagesParam | undefined,
  limit?: number,
): Record<string, string | number | undefined> {
  return {
    cursor: param?.cursor,
    direction: param?.direction,
    around: param?.around,
    limit,
  };
}

export function fetchMessagesWindow(
  companyId: string,
  conversationId: string,
  param: MessagesParam | undefined,
): Promise<MessagesPage> {
  return apiFetch<MessagesPage>(
    `/v1/conversations/${conversationId}/messages`,
    { companyId, searchParams: messagesSearchParams(param) },
  );
}

/** Older pages continue from the oldest row loaded; this is the whole older chain. */
export function nextMessagesParam(
  lastPage: MessagesPage,
): MessagesParam | undefined {
  return lastPage.next_cursor ? { cursor: lastPage.next_cursor } : undefined;
}

/** Newer pages continue from the newest row loaded, or stop at the newest message. */
export function previousMessagesParam(
  firstPage: MessagesPage,
): MessagesParam | undefined {
  return firstPage.newer_cursor
    ? { cursor: firstPage.newer_cursor, direction: "newer" }
    : undefined;
}

/**
 * Whether a cached thread is the one this URL asks for. A thread opened at a
 * message holds a window from the middle of the history, and the plain thread
 * must never be served that window (or the reverse): the window is only valid
 * for its own anchor, or once it has grown to reach the newest message.
 */
export function threadCacheMatches(
  cached: { pages: MessagesPage[]; pageParams: unknown[] } | undefined,
  anchorId: string | null,
): boolean {
  if (!cached) return true;
  if (anchorId !== null) {
    return cached.pageParams.some(
      (param) => (param as MessagesParam | undefined)?.around === anchorId,
    );
  }
  return !cached.pages[0]?.newer_cursor;
}

/** The message the URL asks the thread to open at (`?message=`), if any. */
export function useThreadAnchor(): string | null {
  return useSearchParams().get(THREAD_MESSAGE_PARAM);
}

/**
 * Thread messages — newest-first cursor pages (SPEC §7: (created_at, id)
 * DESC, default 50). Rendering reverses for display; `flattenPages` dedupes.
 *
 * #718: with `?message=<id>` the first page is the window AROUND that message,
 * so a message far back opens at once without walking the history. Older pages
 * continue from `next_cursor`, newer ones from `newer_cursor`
 * (`fetchPreviousPage`); once the window reaches the newest message the thread
 * is the ordinary one again and realtime inserts land in it.
 */
export function useMessages(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const anchorId = useThreadAnchor();
  const queryKey = keys.thread(companyId, conversationId);
  const cached = queryClient.getQueryData<ThreadData>(queryKey);
  const valid = threadCacheMatches(cached, anchorId);
  // A cache from the other mode is dropped (not shown, not refetched in
  // place); the query then starts clean from this URL's first page.
  useEffect(() => {
    if (!valid) queryClient.removeQueries({ queryKey, exact: true });
  }, [valid, queryClient, queryKey]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchMessagesWindow(companyId, conversationId, pageParam),
    initialPageParam: (anchorId ? { around: anchorId } : undefined) as
      | MessagesParam
      | undefined,
    getNextPageParam: nextMessagesParam,
    getPreviousPageParam: previousMessagesParam,
    enabled: valid,
  });
  if (valid) return query;
  return {
    ...query,
    data: undefined,
    isPending: true,
    isError: false,
    hasNextPage: false,
    hasPreviousPage: false,
  } as typeof query;
}

/**
 * #55 — the fresh list row after the viewer's own send: bump the sort key,
 * replace the preview snippet (the realtime handler does the same via
 * `snippetFromMessage`; without it the row jumps to the top still previewing
 * the customer's OLD message whenever the broadcast round-trip is down), and
 * clear the unread dot — the sender has plainly read the thread they just
 * replied in. Pure so it's unit-testable next to the cache reducers it feeds.
 */
export function sentConversationPatch(
  row: ConversationListItem,
  message: Message,
): ConversationListItem {
  return {
    ...row,
    last_message_at: message.created_at,
    last_message: snippetFromMessage(message),
    unread: false,
  };
}

/**
 * POST /v1/messages/send with a client-generated UUID Idempotency-Key
 * (SPEC §7). The API inserts the queued row before calling Telnyx — that row
 * IS the optimistic UI (G1): on success it lands in the thread cache and the
 * conversation bumps to the top of every cached list.
 */
export function useSendMessage(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      body: string;
      media?: OutboundMedia[];
      /**
       * Supplied by the caller so a RETRY of the same text can reuse it. Minting
       * it here meant every attempt carried a fresh key, so a send whose response
       * was lost (flaky signal, tab closed mid-request) sent the customer a
       * SECOND copy on retry — and billed for it. Optional: callers with no
       * retry affordance keep the old behaviour.
       */
      idempotencyKey?: string;
      /**
       * #475: the saved reply this message was built from, if any.
       *
       * Declared by the client because it is the only thing that knows. By the
       * time the body reaches the server it has been merged and possibly
       * edited, so the template cannot be recovered by comparing strings.
       */
      templateId?: string;
      /** #274: whether the words changed after the template was inserted. */
      templateEdited?: boolean;
    }) =>
      apiFetch<Message>("/v1/messages/send", {
        method: "POST",
        companyId,
        idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
        body: {
          conversation_id: conversationId,
          body: input.body,
          ...(input.media && input.media.length > 0
            ? { media: input.media }
            : {}),
          ...(input.templateId
            ? {
                template_id: input.templateId,
                template_edited: input.templateEdited ?? false,
              }
            : {}),
        },
      }),
    onSuccess: (message) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) =>
          threadUpsertMessages(thread, [
            { ...message, attachments: message.attachments ?? [] },
          ]),
      );
      patchConversationLists(queryClient, companyId, (list, filters) => {
        const row = list.pages
          .flatMap((page) => page.data)
          .find((r) => r.id === conversationId);
        if (!row) return list;
        return listApplyConversation(
          list,
          sentConversationPatch(row, message),
          filters,
        );
      });
    },
  });
}

/**
 * PATCH /v1/messages/:id { done } — the D14 toggle. Optimistic: the thread
 * and detail caches flip immediately (strikethrough appears at click), roll
 * back on error, and are replaced by the server row on success. Other clients
 * update via the message.status broadcast the DB trigger emits.
 */
export function useSetMessageDone(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; done: boolean }) =>
      apiFetch<Message>(`/v1/messages/${input.messageId}`, {
        method: "PATCH",
        companyId,
        body: { done: input.done },
      }),
    onMutate: async (input) => {
      const threadKey = keys.thread(companyId, conversationId);
      const detailKey = keys.conversations.detail(companyId, conversationId);
      await queryClient.cancelQueries({ queryKey: threadKey });

      const previousThread = queryClient.getQueryData<ThreadData>(threadKey);
      const previousDetail =
        queryClient.getQueryData<ConversationDetail>(detailKey);

      // The viewer marked it — the me cache is warm (the shell loads it).
      const userId =
        queryClient.getQueryData<Me>(keys.me)?.user_id ?? null;
      const patch = doneMutationPatch(input.done, userId);

      if (previousThread) {
        queryClient.setQueryData<ThreadData>(
          threadKey,
          threadPatchMessage(previousThread, input.messageId, patch),
        );
      }
      if (previousDetail) {
        queryClient.setQueryData<ConversationDetail>(
          detailKey,
          detailPatchMessage(previousDetail, input.messageId, patch),
        );
      }
      return {
        // Undo only the fields this mutation changed. Restoring the whole
        // snapshot also reverted anything that arrived while the request was
        // in flight: a customer's reply appended by realtime mid-mutation was
        // deleted from the open thread and never came back, because nothing
        // refetches afterwards.
        threadInverse: threadInversePatch(previousThread, input.messageId, patch),
        detailInverse: detailInversePatch(previousDetail, input.messageId, patch),
      };
    },
    onError: (_error, input, context) => {
      if (context?.threadInverse) {
        queryClient.setQueryData<ThreadData>(
          keys.thread(companyId, conversationId),
          (thread) =>
            thread
              ? threadPatchMessage(thread, input.messageId, context.threadInverse!)
              : thread,
        );
      }
      if (context?.detailInverse) {
        queryClient.setQueryData<ConversationDetail>(
          keys.conversations.detail(companyId, conversationId),
          (detail) =>
            detailPatchMessage(detail, input.messageId, context.detailInverse!),
        );
      }
    },
    onSuccess: (message) => {
      // Replace the optimistic row with the server's (authoritative done_at).
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) =>
          thread
            ? threadPatchMessage(thread, message.id, message)
            : thread,
      );
      queryClient.setQueryData<ConversationDetail>(
        keys.conversations.detail(companyId, conversationId),
        (detail) => detailPatchMessage(detail, message.id, message),
      );
      // AUDITABLE (APP-LAYOUT-V2 §4.2/§4.3): the done PATCH wrote a
      // message_done / message_undone row into conversation_events. Pull it
      // into the open timeline now — the events infinite query won't refetch
      // on its own (staleTime 30s, refetchOnWindowFocus off), so without this
      // the "X marked '…' done" line wouldn't appear until thread re-entry.
      // Mirrors the status/assign/tag mutations, which invalidate here too.
      queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  });
}

/**
 * PATCH /v1/messages/:id { pinned } — the #3 pin toggle. Optimistic (the pin
 * indicator appears at click), rolls back on error, replaced by the server row
 * on success. Other clients update via the message.status broadcast the DB
 * trigger emits. Unlike done, pinning writes NO conversation_events audit row,
 * so there is nothing to invalidate on the events timeline.
 */
export function useSetMessagePinned(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; pinned: boolean }) =>
      apiFetch<Message>(`/v1/messages/${input.messageId}`, {
        method: "PATCH",
        companyId,
        body: { pinned: input.pinned },
      }),
    onMutate: async (input) => {
      const threadKey = keys.thread(companyId, conversationId);
      const detailKey = keys.conversations.detail(companyId, conversationId);
      await queryClient.cancelQueries({ queryKey: threadKey });

      const previousThread = queryClient.getQueryData<ThreadData>(threadKey);
      const previousDetail =
        queryClient.getQueryData<ConversationDetail>(detailKey);

      const userId = queryClient.getQueryData<Me>(keys.me)?.user_id ?? null;
      const patch = pinMutationPatch(input.pinned, userId);

      if (previousThread) {
        queryClient.setQueryData<ThreadData>(
          threadKey,
          threadPatchMessage(previousThread, input.messageId, patch),
        );
      }
      if (previousDetail) {
        queryClient.setQueryData<ConversationDetail>(
          detailKey,
          detailPatchMessage(previousDetail, input.messageId, patch),
        );
      }
      return {
        // Field-level undo, for the same reason as the done mutation: a
        // whole-snapshot restore also deletes whatever realtime appended while
        // the request was in flight.
        threadInverse: threadInversePatch(previousThread, input.messageId, patch),
        detailInverse: detailInversePatch(previousDetail, input.messageId, patch),
      };
    },
    onError: (_error, input, context) => {
      if (context?.threadInverse) {
        queryClient.setQueryData<ThreadData>(
          keys.thread(companyId, conversationId),
          (thread) =>
            thread
              ? threadPatchMessage(thread, input.messageId, context.threadInverse!)
              : thread,
        );
      }
      if (context?.detailInverse) {
        queryClient.setQueryData<ConversationDetail>(
          keys.conversations.detail(companyId, conversationId),
          (detail) =>
            detailPatchMessage(detail, input.messageId, context.detailInverse!),
        );
      }
    },
    onSuccess: (message) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) =>
          thread ? threadPatchMessage(thread, message.id, message) : thread,
      );
      queryClient.setQueryData<ConversationDetail>(
        keys.conversations.detail(companyId, conversationId),
        (detail) => detailPatchMessage(detail, message.id, message),
      );
      // #13: refresh the conversation-wide pinned set so the banner reflects a
      // pin/unpin of a message that isn't on a loaded thread page.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.pinnedMessages(companyId, conversationId),
      });
    },
  });
}

/**
 * #13 part 2: GET /v1/conversations/:id/pinned — the conversation's COMPLETE
 * pinned-message set (pinned_at desc), so the thread banner shows every pin,
 * not only those on loaded pages. Merged with the loaded-page pins in the
 * banner so an optimistic pin still shows before this refetches.
 */
export function useConversationPinnedMessages(conversationId: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.conversations.pinnedMessages(companyId, conversationId),
    queryFn: async () => {
      const page = await apiFetch<{ data: Message[] }>(
        `/v1/conversations/${conversationId}/pinned`,
        { companyId },
      );
      return page.data;
    },
  });
}

/**
 * POST /v1/messages/:id/retry — only API-failure rows (failed with no Telnyx
 * id) are retryable; carrier-finalized failures 409 (SPEC §7). The returned
 * row (back to queued) replaces the failed one in the thread cache.
 */
export function useRetryMessage(conversationId: string) {
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<Message>(`/v1/messages/${messageId}/retry`, {
        method: "POST",
        companyId,
      }),
    onSuccess: (message) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) =>
          threadUpsertMessages(thread, [
            { ...message, attachments: message.attachments ?? [] },
          ]),
      );
    },
    onError: (error) => {
      // The retry was fully silent before — surface the failure (e.g. a §7 409
      // for a carrier-finalized row, or a network error) so the user knows the
      // message still didn't send. The server's own sentence when there is one
      // (SPEC §7 writes one per code); ours only when nothing came back.
      toast.error(
        error instanceof ApiError ? error.message : t("thread.retrySendFailed"),
      );
    },
  });
}
