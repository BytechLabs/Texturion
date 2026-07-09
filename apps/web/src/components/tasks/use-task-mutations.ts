"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useCompanyId } from "@/lib/company/provider";
import type { Message, Page, Task } from "@/lib/api/types";

/**
 * The /tasks page's done toggle. Unlike the checklist's `useToggleTaskDone`
 * (which is scoped to one conversation), every row on the /tasks page belongs
 * to a DIFFERENT conversation, so this hook takes the task's `message_id` +
 * `conversation_id` per call. It is still the SAME derived-done write path
 * (TASKS.md T2/T4): `PATCH /v1/messages/:id {done}` on the source message —
 * never a task route. Board "move to/from Done", the List status toggle, and
 * the Calendar chip done all call this.
 *
 * Optimistic over every cached /tasks list so a moved/checked card flips at the
 * click; the thread + checklist caches for the affected conversation are
 * invalidated so an open thread and the checklist reconcile via the real
 * `message.status` broadcast + refetch.
 */
export function useTaskDone() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      taskId: string;
      messageId: string;
      conversationId: string;
      done: boolean;
    }) =>
      apiFetch<Message>(`/v1/messages/${input.messageId}`, {
        method: "PATCH",
        companyId,
        body: { done: input.done },
      }),
    onMutate: async (input) => {
      const detailKey = keys.tasks.detail(companyId, input.taskId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: keys.tasks.lists(companyId) }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);

      const snapshots: [readonly unknown[], unknown][] = [];
      const patchRow = (task: Task): Task =>
        task.id === input.taskId
          ? { ...task, done: input.done, status: input.done ? "done" : "open" }
          : task;

      for (const query of queryClient.getQueryCache().findAll({
        queryKey: keys.tasks.lists(companyId),
      })) {
        const data = query.state.data as
          | { pages: Page<Task>[]; pageParams: unknown[] }
          | undefined;
        if (!data) continue;
        snapshots.push([query.queryKey, data]);
        queryClient.setQueryData(query.queryKey, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data.map(patchRow),
          })),
        });
      }

      // #81: also flip the open task-detail drawer, whose check-circle + title
      // strikethrough read keys.tasks.detail — the lists patch alone left the
      // drawer's circle looking unchanged.
      const detail = queryClient.getQueryData<Task>(detailKey);
      if (detail && detail.id === input.taskId) {
        snapshots.push([detailKey, detail]);
        queryClient.setQueryData(detailKey, patchRow(detail));
      }
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _error, input) => {
      // The lists re-read the derived done; the affected thread + checklist +
      // its audit timeline pick up the real message write.
      void queryClient.invalidateQueries({ queryKey: keys.tasks.lists(companyId) });
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.detail(companyId, input.taskId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.checklist(companyId, input.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.thread(companyId, input.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.detail(companyId, input.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, input.conversationId),
      });
    },
  });
}

/**
 * The Calendar view's drag-reschedule: `PATCH /v1/tasks/:id { due_at }` (task
 * metadata, TASKS.md T4 — a due change writes `task_due_set`). Page-scoped (the
 * checklist's `useSetTaskDue` is conversation-scoped, but calendar tasks span
 * conversations). Optimistic over every cached /tasks list so a dropped chip
 * lands on the new day instantly; rolls back on error.
 */
export function useTaskReschedule() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { taskId: string; conversationId: string; due_at: string | null }) =>
      apiFetch<Task>(`/v1/tasks/${input.taskId}`, {
        method: "PATCH",
        companyId,
        body: { due_at: input.due_at },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks.lists(companyId) });
      const snapshots: [readonly unknown[], unknown][] = [];
      const patchRow = (task: Task): Task =>
        task.id === input.taskId ? { ...task, due_at: input.due_at } : task;

      for (const query of queryClient.getQueryCache().findAll({
        queryKey: keys.tasks.lists(companyId),
      })) {
        const data = query.state.data as
          | { pages: Page<Task>[]; pageParams: unknown[] }
          | undefined;
        if (!data) continue;
        snapshots.push([query.queryKey, data]);
        queryClient.setQueryData(query.queryKey, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data.map(patchRow),
          })),
        });
      }
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: keys.tasks.lists(companyId) });
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.checklist(companyId, input.conversationId),
      });
    },
  });
}
