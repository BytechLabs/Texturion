import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import {
  detailPatchMessage,
  doneMutationPatch,
  threadPatchMessage,
  threadUpsertMessages,
  type ThreadData,
} from "./cache";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { TaskListFilters } from "./task-filters";
import { taskSearchParams } from "./task-params";
import type {
  ChecklistTask,
  ConversationDetail,
  Me,
  Message,
  Page,
  Task,
  TaskDetail,
  TaskStatus,
} from "./types";

/**
 * Tasks API hooks (D17 / TASKS.md). A task is metadata over a real message;
 * **completion is DERIVED** from the source message's `messages.done_at` (T2),
 * so there is no task-side done write here — checking a task's box goes through
 * the existing `PATCH /v1/messages/:id {done}` on `task.message_id`
 * (`useToggleTaskDone` below), and the derived `done`/`status` flip on the next
 * read. These are the shared hooks the /tasks page (list/board/calendar/map),
 * the conversation checklist, and the create-from-message affordance all
 * consume — the single typed surface over the real /v1 routes.
 *
 * Realtime: task metadata mutations (create/assign/due/delete) emit the ID-only
 * `task.changed {conversation_id}` broadcast (T1.3); done rides the existing
 * `message.status` broadcast. The realtime layer invalidates the checklist +
 * lists keys off those; these hooks additionally patch/invalidate optimistically
 * so the acting client never waits for the round-trip.
 */

// ---------------------------------------------------------------------------
// List filters (the /tasks page query surface — T6.1 / D25)
// ---------------------------------------------------------------------------

// The filter shape + the pure query-param serializer live in dependency-free
// sibling modules (task-filters / task-params) so they are unit-testable
// without importing this hook chain. Re-exported here so existing consumers
// (`import { TaskListFilters, taskSearchParams } from "@/lib/api/tasks"`) are
// unaffected.
export type { TaskListFilters };

// ---------------------------------------------------------------------------
// Fetchers (pure — reused by prefetch/tests)
// ---------------------------------------------------------------------------

export function fetchTasksPage(
  companyId: string,
  filters: TaskListFilters,
  cursor?: string,
): Promise<Page<Task>> {
  return apiFetch<Page<Task>>("/v1/tasks", {
    companyId,
    searchParams: taskSearchParams(filters, cursor),
  });
}

export function fetchConversationTasks(
  companyId: string,
  conversationId: string,
): Promise<{ data: ChecklistTask[] }> {
  return apiFetch<{ data: ChecklistTask[] }>(
    `/v1/conversations/${conversationId}/tasks`,
    { companyId },
  );
}

export function fetchTask(
  companyId: string,
  taskId: string,
): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/v1/tasks/${taskId}`, { companyId });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * GET /v1/tasks — the /tasks page's filtered, cursor-paginated list (T6.1).
 * Due-sorted views (overdue / due-range) key on (due_at NULLS LAST, id);
 * created-sorted otherwise — the route mints the matching cursor shape, so the
 * page just follows `next_cursor`.
 */
export function useTasks(
  filters: TaskListFilters = {},
  options?: { enabled?: boolean },
) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.tasks.list(companyId, filters),
    queryFn: ({ pageParam }) =>
      fetchTasksPage(companyId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    enabled: options?.enabled ?? true,
  });
}

/**
 * `useTasks` that auto-drains every remaining page, for the whole-set views
 * (Board / Calendar / Map, D25). Those views partition/plot the COMPLETE result
 * — a card silently dropped past page 1 (the default 25) would corrupt the
 * board columns, month grid, or pin set — so they can't stop at page 1 like the
 * List view's explicit "Load more". This walks `fetchNextPage` until
 * `hasNextPage` is false; a hard page ceiling bounds the walk so a pathological
 * result set can never spin forever. Returns the same query object, so callers
 * read `query.data` / loading / error exactly as with `useTasks`.
 */
const MAX_TASK_PAGES = 40; // 40 × 25 = 1000 tasks; a hard upper bound.

export function useAllTasks(
  filters: TaskListFilters = {},
  options?: { enabled?: boolean },
) {
  const query = useTasks(filters, options);
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    fetchNextPage,
    data,
  } = query;
  const pageCount = data?.pages.length ?? 0;

  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetching &&
      pageCount < MAX_TASK_PAGES
    ) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetching, pageCount, fetchNextPage]);

  return query;
}

/**
 * GET /v1/conversations/:id/tasks — the conversation checklist (T5.2). No
 * cursor (a thread's task count is small). `enabled` gates the fetch to when
 * the context panel is actually open.
 */
export function useConversationTasks(
  conversationId: string,
  options?: { enabled?: boolean },
) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tasks.checklist(companyId, conversationId),
    queryFn: () => fetchConversationTasks(companyId, conversationId),
    enabled: options?.enabled ?? true,
  });
}

/** GET /v1/tasks/:id — one task's full detail (T6.2). */
export function useTask(taskId: string, options?: { enabled?: boolean }) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.tasks.detail(companyId, taskId),
    queryFn: () => fetchTask(companyId, taskId),
    enabled: options?.enabled ?? true,
  });
}

// ---------------------------------------------------------------------------
// Metadata mutations (create / assign / set-due / update / delete)
//
// All emit `task.changed` server-side; the acting client invalidates the
// affected conversation's checklist + the /tasks lists root so both re-read the
// derived state without waiting for the broadcast.
// ---------------------------------------------------------------------------

/** Invalidate every task read touched by a metadata change on one thread. */
function invalidateTasks(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: keys.tasks.checklist(companyId, conversationId),
  });
  void queryClient.invalidateQueries({ queryKey: keys.tasks.lists(companyId) });
}

export interface CreateTaskInput {
  /** The message being promoted (required — every task promotes a message). */
  message_id: string;
  /** Optional overrides; an absent title lets the RPC seed the body snippet. */
  title?: string;
  description?: string;
  assigned_user_id?: string | null;
  due_at?: string | null;
}

/**
 * POST /v1/tasks — promote a message to a task (T4/T5.1). This is the write the
 * message overflow "Make a task" affordance and any future compose surface
 * call. A second live promotion of the same message → 409 `conflict` (the
 * caller surfaces "already a task"). Refetches the source thread's checklist +
 * the /tasks lists, and the conversation events (the `task_created` audit line).
 *
 * `conversationId` is required so the created task's cache/audit refetch targets
 * the right thread even before the returned row is inspected.
 */
export function useCreateTaskFromMessage(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>("/v1/tasks", {
        method: "POST",
        companyId,
        body: {
          message_id: input.message_id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.assigned_user_id !== undefined
            ? { assigned_user_id: input.assigned_user_id }
            : {}),
          ...(input.due_at !== undefined ? { due_at: input.due_at } : {}),
        },
      }),
    onSuccess: (task) => {
      invalidateTasks(queryClient, companyId, task.conversation_id);
      // The `task_created` line lands in the open timeline (§4.3).
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
      });
    },
  });
}

/** The metadata PATCH body (T4) — no `done` field (that's the message route). */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assigned_user_id?: string | null;
  due_at?: string | null;
}

/**
 * PATCH /v1/tasks/:id — metadata only (T4). Assign / set-due / rename all flow
 * through here; an assignee change writes `task_assigned`, a due change
 * `task_due_set`. OPTIMISTIC: the edited fields patch the detail cache at the
 * click (so the drawer's fields never flicker back), roll back on error, and
 * the server row replaces the optimistic one on success. The checklist + lists
 * are invalidated so their derived views re-read. The detail cache is also
 * invalidated on settle so the `activity` timeline picks up the new
 * `task_assigned` / `task_due_set` line.
 */
export function useUpdateTask(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string } & UpdateTaskInput) => {
      const { taskId, ...body } = input;
      return apiFetch<Task>(`/v1/tasks/${taskId}`, {
        method: "PATCH",
        companyId,
        body,
      });
    },
    onMutate: async (input) => {
      const { taskId, ...patch } = input;
      const detailKey = keys.tasks.detail(companyId, taskId);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previousDetail = queryClient.getQueryData<TaskDetail>(detailKey);
      if (previousDetail) {
        queryClient.setQueryData<TaskDetail>(detailKey, {
          ...previousDetail,
          ...patch,
        });
      }
      return { previousDetail, detailKey };
    },
    onError: (_error, _input, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<TaskDetail>(
        keys.tasks.detail(companyId, task.id),
        (detail) => (detail ? { ...detail, ...task } : detail),
      );
      invalidateTasks(queryClient, companyId, conversationId);
    },
    onSettled: (_data, _error, input) => {
      // Pull the fresh task_assigned / task_due_set line into the drawer's
      // activity timeline (the detail carries `activity`).
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.detail(companyId, input.taskId),
      });
    },
  });
}

/** Convenience over `useUpdateTask` — assign (or unassign with null). */
export function useAssignTask(conversationId: string) {
  const update = useUpdateTask(conversationId);
  return {
    ...update,
    assign: (taskId: string, assigned_user_id: string | null) =>
      update.mutate({ taskId, assigned_user_id }),
    assignAsync: (taskId: string, assigned_user_id: string | null) =>
      update.mutateAsync({ taskId, assigned_user_id }),
  };
}

/** Convenience over `useUpdateTask` — set (or clear with null) the due date. */
export function useSetTaskDue(conversationId: string) {
  const update = useUpdateTask(conversationId);
  return {
    ...update,
    setDue: (taskId: string, due_at: string | null) =>
      update.mutate({ taskId, due_at }),
    setDueAsync: (taskId: string, due_at: string | null) =>
      update.mutateAsync({ taskId, due_at }),
  };
}

/**
 * POST /v1/conversations/:id/notes { body, task_id } — the task drawer's note
 * composer (TASKS-V2 D-D). One primitive: the note is an internal note that
 * interweaves in the conversation thread AND collects in the task's activity
 * timeline. On success it upserts the note into the open thread cache (so it
 * shows immediately in the thread with its "on: <task title>" chip) and
 * invalidates the task detail (so the drawer's activity picks it up) plus the
 * conversation events (belt-and-braces). `taskId` scopes the invalidation.
 */
export function useCreateTaskNote(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; body: string }) =>
      apiFetch<Message>(`/v1/conversations/${conversationId}/notes`, {
        method: "POST",
        companyId,
        body: { body: input.body, task_id: input.taskId },
      }),
    onSuccess: (note, input) => {
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversationId),
        (thread) =>
          threadUpsertMessages(thread, [
            { ...note, attachments: note.attachments ?? [] },
          ]),
      );
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.detail(companyId, input.taskId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.detail(companyId, conversationId),
      });
    },
  });
}

/**
 * DELETE /v1/tasks/:id — soft-delete (T4, creator or owner/admin). Does NOT
 * touch the source message's done state (removing the promotion leaves the D14
 * done mark intact). Optimistically drops the row from the conversation
 * checklist, rolls back on error, and invalidates the /tasks lists.
 */
export function useDeleteTask(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const checklistKey = keys.tasks.checklist(companyId, conversationId);
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<void>(`/v1/tasks/${taskId}`, {
        method: "DELETE",
        companyId,
      }),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: checklistKey });
      const previous =
        queryClient.getQueryData<{ data: ChecklistTask[] }>(checklistKey);
      if (previous) {
        queryClient.setQueryData<{ data: ChecklistTask[] }>(checklistKey, {
          data: previous.data.filter((t) => t.id !== taskId),
        });
      }
      return { previous };
    },
    onError: (_error, _taskId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(checklistKey, context.previous);
      }
    },
    onSettled: () => {
      invalidateTasks(queryClient, companyId, conversationId);
    },
  });
}

// ---------------------------------------------------------------------------
// Completion — the DERIVED done toggle (T2)
//
// A task's box is a SECOND entry point to the existing message done PATCH; there
// is no task-side write. This patches the checklist (derived done), the thread,
// and the detail caches optimistically off the source message id — exactly the
// same column the in-thread D14 toggle writes, so both surfaces stay in lockstep
// via the one `message.status` broadcast.
// ---------------------------------------------------------------------------

/** Patch a task's derived done state inside the cached conversation checklist. */
function checklistPatchDone(
  data: { data: ChecklistTask[] } | undefined,
  messageId: string,
  done: boolean,
): { data: ChecklistTask[] } | undefined {
  if (!data) return data;
  let changed = false;
  const next = data.data.map((task) => {
    if (task.message_id !== messageId) return task;
    changed = true;
    return { ...task, done, status: (done ? "done" : "open") as TaskStatus };
  });
  if (!changed) return data;
  return { data: next };
}

/**
 * Toggle a promoted task's completion (T2). Calls the EXISTING
 * `PATCH /v1/messages/:id {done}` on the task's source message — the checkbox
 * is a second UI entry to that one write. Optimistically flips the checklist's
 * derived done AND the source message's done state in the thread/detail caches
 * (so an open conversation strikes the message through at the same instant),
 * rolls back on error, and pulls the fresh `message_done`/`message_undone`
 * audit line into the open timeline.
 *
 * `conversationId` scopes the caches to the checklist's thread.
 */
export function useToggleTaskDone(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const checklistKey = keys.tasks.checklist(companyId, conversationId);
  const threadKey = keys.thread(companyId, conversationId);
  const detailKey = keys.conversations.detail(companyId, conversationId);

  return useMutation({
    mutationFn: (input: { messageId: string; done: boolean }) =>
      apiFetch<Message>(`/v1/messages/${input.messageId}`, {
        method: "PATCH",
        companyId,
        body: { done: input.done },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: checklistKey });
      await queryClient.cancelQueries({ queryKey: threadKey });

      const previousChecklist =
        queryClient.getQueryData<{ data: ChecklistTask[] }>(checklistKey);
      const previousThread = queryClient.getQueryData<ThreadData>(threadKey);
      const previousDetail =
        queryClient.getQueryData<ConversationDetail>(detailKey);

      // The viewer is the actor — the me cache is warm (the shell loads it).
      const userId = queryClient.getQueryData<Me>(keys.me)?.user_id ?? null;
      const messagePatch = doneMutationPatch(input.done, userId);

      queryClient.setQueryData<{ data: ChecklistTask[] }>(
        checklistKey,
        (data) => checklistPatchDone(data, input.messageId, input.done),
      );
      if (previousThread) {
        queryClient.setQueryData<ThreadData>(
          threadKey,
          threadPatchMessage(previousThread, input.messageId, messagePatch),
        );
      }
      if (previousDetail) {
        queryClient.setQueryData<ConversationDetail>(
          detailKey,
          detailPatchMessage(previousDetail, input.messageId, messagePatch),
        );
      }
      return { previousChecklist, previousThread, previousDetail };
    },
    onError: (_error, _input, context) => {
      if (context?.previousChecklist) {
        queryClient.setQueryData(checklistKey, context.previousChecklist);
      }
      if (context?.previousThread) {
        queryClient.setQueryData(threadKey, context.previousThread);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
    },
    onSuccess: (message) => {
      // Replace the optimistic message row with the server's authoritative one
      // (done_at) in the thread/detail caches; the checklist's derived done was
      // already patched and matches.
      queryClient.setQueryData<ThreadData>(threadKey, (thread) =>
        thread ? threadPatchMessage(thread, message.id, message) : thread,
      );
      queryClient.setQueryData<ConversationDetail>(detailKey, (detail) =>
        detailPatchMessage(detail, message.id, message),
      );
      queryClient.setQueryData<{ data: ChecklistTask[] }>(
        checklistKey,
        (data) =>
          checklistPatchDone(data, message.id, message.done_at !== null),
      );
      // Surface the message_done / message_undone line in the open timeline.
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    },
  });
}
