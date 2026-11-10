"use client";

import { Check, CalendarClock, Link2, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT, type Translate } from "@/i18n/provider";
import { useDeleteTask } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/types";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import type { RecordAction } from "@/lib/record-actions/types";
import { useNavigate } from "@/lib/use-navigate";

import { taskThreadId } from "./task-format";
import { movedDueAt, RESCHEDULE_MOVES } from "./task-reschedule";
import { TASK_DRAWER_PARAM, useTaskDrawer } from "./use-task-drawer";
import { useTaskDone, useTaskReschedule } from "./use-task-mutations";

/**
 * #712 — the task's ONE action list. The detail panel's ⋯, and the right-click /
 * long-press menu on a list row, a board card and a calendar chip all render it.
 *
 * `hasAccess` is the viewer's access to the conversation the task came from
 * (#107): completion is derived from the source message, so without access the
 * server refuses it, and offering it would be a dead item. Delete follows its
 * own gate (`records.delete`).
 */
export interface TaskActionsInput {
  t: Translate;
  task: Pick<Task, "done" | "due_at">;
  hasAccess: boolean;
  canDelete: boolean;
  deleting: boolean;
  /** Absent where the task is already open (the detail panel). */
  openHref?: string;
  /** Whether a shareable link can be built here. */
  canCopyLink: boolean;
  now: Date;
  run: {
    open: () => void;
    copyLink: () => void;
    toggleDone: () => void;
    setDue: (dueAt: string) => void;
    requestDelete: () => void;
  };
}

export function buildTaskActions(input: TaskActionsInput): RecordAction[] {
  const { t, run } = input;
  return [
    {
      id: "open",
      label: t("recordMenu.open"),
      icon: SquareArrowOutUpRight,
      group: "primary",
      allowed: input.openHref !== undefined,
      onSelect: run.open,
    },
    {
      id: "copy-link",
      label: t("recordMenu.copyLink"),
      icon: Link2,
      group: "primary",
      allowed: input.canCopyLink,
      onSelect: run.copyLink,
    },
    {
      // Mirrors the check-circle: the same derived-done write and the same
      // access requirement. A state, so a toggle named for the state.
      id: "done",
      label: t("tasks.markDoneAction"),
      icon: Check,
      group: "state",
      allowed: input.hasAccess,
      checked: input.task.done,
      onSelect: run.toggleDone,
    },
    {
      id: "due",
      label: t("recordMenu.moveDueDate"),
      icon: CalendarClock,
      group: "state",
      allowed: input.hasAccess,
      submenu: RESCHEDULE_MOVES.map((move) => ({
        id: String(move.days),
        label: t(move.labelKey),
        onSelect: () =>
          run.setDue(movedDueAt(input.task.due_at, move.days, input.now)),
      })),
    },
    {
      // #89: a real, destructive Delete (records.delete only).
      id: "delete",
      label: t("tasks.deleteTask"),
      icon: Trash2,
      group: "danger",
      allowed: input.canDelete,
      destructive: true,
      disabled: input.deleting,
      onSelect: run.requestDelete,
    },
  ];
}

/** The link a task opens at: the tasks board with the drawer on that task. */
export function taskLink(taskId: string): string {
  return `/tasks?${TASK_DRAWER_PARAM}=${encodeURIComponent(taskId)}`;
}

/**
 * Wires a task ROW's action list (list, board card, calendar chip) to the API.
 * Delete asks first with a plain confirmation, since a row does not carry the
 * notes and files the detail panel weighs before it asks; a repeating task
 * deletes only the occurrence you pointed at.
 *
 * Render `dialogs` outside any menu: a dialog mounted inside menu content
 * unmounts the moment the menu closes.
 */
export function useTaskRowActions(task: Task) {
  const t = useT();
  const navigate = useNavigate();
  const { hrefForTask } = useTaskDrawer();
  const canDelete = useCanDeleteRecords();
  const done = useTaskDone();
  const reschedule = useTaskReschedule();
  const del = useDeleteTask(taskThreadId(task));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const href = hrefForTask(task.id);

  const actions = buildTaskActions({
    t,
    task,
    // Only the detail carries the viewer's level; a list row is treated as
    // reachable and the server still refuses what it must.
    hasAccess: !("viewer_level" in task && task.viewer_level === "none"),
    canDelete,
    deleting: del.isPending,
    openHref: href,
    canCopyLink: true,
    now: new Date(),
    run: {
      open: () => navigate(href, { scroll: false }),
      copyLink: async () => {
        try {
          await navigator.clipboard.writeText(
            `${window.location.origin}${taskLink(task.id)}`,
          );
          toast.success(t("recordMenu.linkCopied"));
        } catch {
          toast.error(t("thread.copyFailed"));
        }
      },
      toggleDone: () =>
        done.mutate(
          {
            taskId: task.id,
            messageId: task.message_id,
            conversationId: taskThreadId(task),
            done: !task.done,
          },
          { onError: () => toast.error(t("tasks.updateFailed")) },
        ),
      setDue: (dueAt) =>
        reschedule.mutate({
          taskId: task.id,
          conversationId: taskThreadId(task),
          due_at: dueAt,
        }),
      requestDelete: () => setConfirmDelete(true),
    },
  });

  const dialogs = confirmDelete ? (
    <Dialog open onOpenChange={setConfirmDelete}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("tasks.deleteConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("recordMenu.taskDeleteBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmDelete(false)}
            disabled={del.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(
                { taskId: task.id },
                {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    toast.success(t("tasks.deleted"));
                  },
                  onError: () => {
                    setConfirmDelete(false);
                    toast.error(t("tasks.deleteFailed"));
                  },
                },
              )
            }
          >
            {t("tasks.deleteTask")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { actions, dialogs };
}
