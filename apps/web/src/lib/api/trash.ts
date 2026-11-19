/**
 * #691 — deleting messages, conversations, calls and voicemails, and the Trash
 * they land in for 30 days.
 *
 * Every delete here is a MOVE to the Trash, so the forward calls and the undo
 * (`POST /v1/trash/restore`) are the same pair the Trash page uses: one restore
 * path, whichever surface asked for it. Delete forever is the only call that
 * cannot be taken back, and it lives on the Trash page behind a typed
 * confirmation, never behind an undo toast.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { Page } from "./types";

export type TrashKind = "conversation" | "message" | "call" | "voicemail" | "contact";
export type TrashSourceKind = "message" | "call";

export interface TrashLinkedTask {
  id: string;
  number: number;
  trashed: boolean;
}

interface TrashRowBase {
  id: string;
  deleted_at: string;
  deleted_by_user_id: string | null;
  /** When the nightly purge erases it for good. */
  purge_after: string;
}

export type TrashRow =
  | (TrashRowBase & {
      kind: "contact";
      contact: {
        contact_name: string | null;
        contact_phone: string | null;
      };
    })
  | (TrashRowBase & {
      kind: "conversation";
      conversation: {
        contact_name: string | null;
        contact_phone: string | null;
        message_count: number;
      };
    })
  | (TrashRowBase & {
      kind: "message";
      message: {
        contact_name: string | null;
        contact_phone: string | null;
        conversation_id: string;
        direction: "inbound" | "outbound" | "note";
        snippet: string | null;
        linked_tasks?: TrashLinkedTask[];
      };
    })
  | (TrashRowBase & {
      kind: "call";
      call: {
        contact_name: string | null;
        contact_phone: string | null;
        outcome: "answered" | "voicemail" | "missed" | null;
        started_at: string;
        has_voicemail: boolean;
        linked_tasks?: TrashLinkedTask[];
      };
    })
  | (TrashRowBase & {
      kind: "voicemail";
      voicemail: {
        contact_name: string | null;
        contact_phone: string | null;
        started_at: string;
        voicemail_seconds: number | null;
      };
    });

/** What a deleted item is, as the Trash restore endpoint names it. */
export interface TrashTarget {
  kind: TrashKind;
  id: string;
}

/**
 * A delete can move rows in the inbox, the open thread, the call log, the
 * contact's history and the Trash itself. Invalidating each root is cheaper to
 * get right than patching them, and a delete is rare.
 */
export function invalidateAfterDeletion(
  queryClient: QueryClient,
  companyId: string,
): void {
  for (const root of ["contacts", "conversations", "messages", "calls", "trash", "search", "tasks"]) {
    void queryClient.invalidateQueries({
      queryKey: [companyId, root],
      refetchType: "active",
    });
  }
  void queryClient.invalidateQueries({ queryKey: keys.forYou(companyId), refetchType: "active" });
}

function useDeletion<TInput, TResult>(
  call: (input: TInput, companyId: string) => Promise<TResult>,
) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => call(input, companyId),
    onSuccess: () => invalidateAfterDeletion(queryClient, companyId),
  });
}

export function useDeleteMessage() {
  return useDeleteSource("message");
}

export function useDeleteConversation() {
  return useDeletion((conversationId: string, companyId) =>
    apiFetch<{ kind: "conversation"; id: string }>(
      `/v1/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE", companyId },
    ),
  );
}

/** The API takes 1..100 ids per call. */
export const BULK_DELETE_LIMIT = 100;

/**
 * Delete many conversations. Chunked at the API's cap, and the result is the
 * ids the SERVER says it deleted: a row on a hidden number, or one already gone,
 * is simply absent, and the toast and the undo are built from this list rather
 * than from the selection.
 */
export function useDeleteConversations() {
  return useDeletion(async (ids: readonly string[], companyId) => {
    const deleted: string[] = [];
    for (let at = 0; at < ids.length; at += BULK_DELETE_LIMIT) {
      const result = await apiFetch<{ deleted: string[] }>(
        "/v1/conversations/delete",
        {
          method: "POST",
          companyId,
          body: { ids: ids.slice(at, at + BULK_DELETE_LIMIT) },
        },
      );
      deleted.push(...result.deleted);
    }
    return { deleted };
  });
}

/** `id` is the call-log row's id, not its `call_session_id`. */
export function useDeleteCall() {
  return useDeleteSource("call");
}

function useDeleteSource(kind: TrashSourceKind) {
  const collection = kind === "message" ? "messages" : "calls";
  return useDeletion(({ id, includeTasks }: { id: string; includeTasks: boolean }, companyId) =>
    apiFetch<{ kind: TrashSourceKind; id: string; linked_tasks?: TrashLinkedTask[] }>(
      `/v1/${collection}/${encodeURIComponent(id)}`,
      { method: "DELETE", companyId, searchParams: { include_tasks: includeTasks ? "true" : undefined } },
    ),
  );
}

export function useTrashSourceTasks(kind: TrashSourceKind, id: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "trash", "source-tasks", kind, id],
    queryFn: async () => {
      const data = await apiFetch<{ linked_tasks: TrashLinkedTask[] }>(
        `/v1/trash/source-tasks/${kind}/${encodeURIComponent(id)}`,
        { companyId },
      );
      return data.linked_tasks;
    },
  });
}

/** The recording and transcript only; the call stays in the log. */
export function useDeleteVoicemail() {
  return useDeletion((callId: string, companyId) =>
    apiFetch<unknown>(`/v1/calls/${encodeURIComponent(callId)}/voicemail`, {
      method: "DELETE",
      companyId,
    }),
  );
}

/** Undo for every delete, and the Trash page's Restore. */
export function useRestoreFromTrash() {
  return useDeletion(async (targets: readonly TrashTarget[], companyId) => {
    let scheduledMissed = 0;
    for (const target of targets) {
      const result = await apiFetch<{ scheduled_missed?: number }>("/v1/trash/restore", {
        method: "POST",
        companyId,
        body: target,
      });
      scheduledMissed += result.scheduled_missed ?? 0;
    }
    return { scheduledMissed };
  });
}

export function useTrash() {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: [companyId, "trash", "list"] as const,
    queryFn: ({ pageParam }) =>
      apiFetch<Page<TrashRow>>("/v1/trash", {
        companyId,
        searchParams: { cursor: pageParam, limit: 50 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
}

/** Delete forever: gone, with its files. 409 under a legal hold. */
export function usePurgeTrashItem() {
  return useDeletion((target: TrashTarget, companyId) =>
    apiFetch<undefined>(
      `/v1/trash/${target.kind}/${encodeURIComponent(target.id)}`,
      { method: "DELETE", companyId },
    ),
  );
}
