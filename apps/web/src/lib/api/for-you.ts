import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { ForYou, ForYouTask, Message } from "./types";

/**
 * GET /v1/for-you — the D23 crew-member focus queue: one derived object with
 * the four urgency-sorted, bounded sections (waiting_on_you / my_tasks /
 * unread / triage). It is a working queue, not a paginated list, so a single
 * query (no cursor) is the whole surface.
 *
 * Realtime: the queue is derived over conversations + tasks + reads, so it
 * refetches on the same broadcasts that move those (message.created,
 * conversation.updated, task.changed) — the realtime provider invalidates
 * `keys.forYou` on those events. `staleTime` keeps a tab switch from refetching
 * needlessly while the broadcasts keep it live.
 */
export function useForYou() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.forYou(companyId),
    queryFn: () => apiFetch<ForYou>("/v1/for-you", { companyId }),
    staleTime: 30_000,
  });
}

/**
 * Remove a task (by id) from every section of a cached ForYou object. Pure so
 * the optimistic-complete and its undo are exact inverses over the cache.
 */
function forYouWithoutTask(data: ForYou | undefined, taskId: string): ForYou | undefined {
  if (!data) return data;
  return {
    ...data,
    my_tasks: data.my_tasks.filter((t) => t.task_id !== taskId),
    triage: data.triage
      ? {
          ...data.triage,
          tasks: data.triage.tasks.filter((t) => t.task_id !== taskId),
        }
      : data.triage,
  };
}

/**
 * Complete a /for-you task inline (D23 §2). Completion is DERIVED from the
 * source message's done state (TASKS.md T2/T4), so this is the SAME
 * `PATCH /v1/messages/:id {done}` path every other view uses — never a task
 * route. Optimistic: the task drops out of the focus queue at click (an open
 * task's `my_tasks`/triage membership is exactly "not done"); the 5s undo
 * re-adds it and the caller re-marks the message not-done.
 *
 * The mutation only owns the for-you cache patch + server write; the page wires
 * the undo toast (components/ui/optimistic-undo) so the whole gesture reads as
 * one calm action. On settle the queue is invalidated so the server's
 * re-derivation (which also reshuffles the linked conversation's urgency) wins.
 */
export function useCompleteForYouTask() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  return useMutation({
    // `done` is a param so the same hook drives complete (true) and the undo
    // (false) — both are message-done writes on the task's source message.
    mutationFn: (input: { task: ForYouTask; done: boolean }) =>
      apiFetch<Message>(`/v1/messages/${input.task.message_id}`, {
        method: "PATCH",
        companyId,
        body: { done: input.done },
      }),
    onMutate: async (input) => {
      const key = keys.forYou(companyId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ForYou>(key);
      // Completing removes the task from the open-task sections; the undo path
      // (done=false) relies on the settle-time invalidation to bring it back.
      if (input.done) {
        queryClient.setQueryData<ForYou>(key, (data) =>
          forYouWithoutTask(data, input.task.task_id),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(keys.forYou(companyId), context.previous);
      }
    },
    onSettled: () => {
      // The completed/uncompleted task changes the queue AND the linked thread's
      // done audit; re-derive both from the server (message.status also broadcast
      // to other clients by the DB trigger).
      queryClient.invalidateQueries({ queryKey: keys.forYou(companyId) });
      queryClient.invalidateQueries({
        queryKey: keys.threads(companyId),
        refetchType: "active",
      });
    },
  });
}
