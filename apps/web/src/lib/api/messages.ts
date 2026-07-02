import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import {
  threadUpsertMessages,
  type ThreadData,
} from "./cache";
import { apiFetch } from "./client";
import { listApplyConversation } from "./cache";
import { patchConversationLists } from "./conversations";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { Message, Page } from "./types";

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
