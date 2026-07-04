import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import {
  detailPatchMessage,
  doneMutationPatch,
  threadPatchMessage,
  threadUpsertMessages,
  type ThreadData,
} from "./cache";
import { apiFetch } from "./client";
import { listApplyConversation } from "./cache";
import { patchConversationLists } from "./conversations";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { ConversationDetail, Me, Message, Page } from "./types";

/** Outbound media item (SPEC §7: ≤3 items, ≤1 MB decoded, jpeg/png/gif). */
export interface OutboundMedia {
  content_type: "image/jpeg" | "image/png" | "image/gif";
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
 * Thread messages — newest-first cursor pages (SPEC §7: (created_at, id)
 * DESC, default 50). Rendering reverses for display; `flattenPages` dedupes.
 */
export function useMessages(conversationId: string) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.thread(companyId, conversationId),
    queryFn: ({ pageParam }) =>
      fetchMessagesPage(companyId, conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
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
    mutationFn: (input: { body: string; media?: OutboundMedia[] }) =>
      apiFetch<Message>("/v1/messages/send", {
        method: "POST",
        companyId,
        idempotencyKey: crypto.randomUUID(),
        body: {
          conversation_id: conversationId,
          body: input.body,
          ...(input.media && input.media.length > 0
            ? { media: input.media }
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
          { ...row, last_message_at: message.created_at },
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
      return { previousThread, previousDetail };
    },
    onError: (_error, _input, context) => {
      // Roll back both caches to their pre-mutation snapshots.
      if (context?.previousThread) {
        queryClient.setQueryData(
          keys.thread(companyId, conversationId),
          context.previousThread,
        );
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          keys.conversations.detail(companyId, conversationId),
          context.previousDetail,
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
 * POST /v1/messages/:id/retry — only API-failure rows (failed with no Telnyx
 * id) are retryable; carrier-finalized failures 409 (SPEC §7). The returned
 * row (back to queued) replaces the failed one in the thread cache.
 */
export function useRetryMessage(conversationId: string) {
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
  });
}
