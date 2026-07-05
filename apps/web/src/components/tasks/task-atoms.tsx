"use client";

import { Check } from "lucide-react";

import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { formatDue, isOverdue } from "./task-format";
import { useTaskDone } from "./use-task-mutations";

/**
 * The one petrol *state* mark a task row is allowed (APP-LAYOUT-V2 §4.1): a
 * done checkbox that IS the D14 done control — checking it calls the source
 * message's PATCH /v1/messages/:id {done} (derived completion, TASKS.md T2).
 * Petrol when done, quiet stone ring when open; `aria-pressed` toggle with the
 * D14 SR labels because it is literally the message-done control.
 */
export function TaskDoneCheckbox({
  task,
  className,
}: {
  task: Task;
  className?: string;
}) {
  const done = useTaskDone();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? "Mark not done" : "Mark done"}
      // Guard against a double-submit while the derived PATCH is in flight —
      // matching the for-you TaskRow checkbox, the same message-done write (#4).
      disabled={done.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        done.mutate({
          taskId: task.id,
          messageId: task.message_id,
          conversationId: task.conversation_id,
          done: !task.done,
        });
      }}
      className={cn(
        "tap-target flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        task.done
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input text-transparent hover:border-primary/60",
        className,
      )}
    >
      <Check className="size-3" strokeWidth={2.5} aria-hidden />
    </button>
  );
}

/** The derived-status pill (T6.1): quiet stone for open, success tint for done. */
export function TaskStatusPill({ task }: { task: Task }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        task.done
          ? "bg-success/10 text-emerald-700 dark:bg-success/15 dark:text-success"
          : "bg-secondary text-stone-600 dark:text-muted-foreground",
      )}
    >
      {task.done ? "Done" : "Open"}
    </span>
  );
}

/**
 * The due cell/chip (T6.1): tabular stone-400, amber ONLY when overdue and
 * not-done (never a red scare). Renders nothing for a task with no due date.
 */
export function TaskDue({
  task,
  className,
}: {
  task: Task;
  className?: string;
}) {
  if (task.due_at === null) return null;
  const overdue = isOverdue(task);
  return (
    <span
      className={cn(
        "tabular-nums",
        overdue ? "font-medium text-warning" : "text-muted-foreground",
        className,
      )}
      title={overdue ? "Overdue" : undefined}
    >
      {formatDue(task.due_at)}
    </span>
  );
}

/** The assignee cell (T6.1): avatar + name, or a quiet "Unassigned". */
export function TaskAssignee({
  task,
  showName = true,
}: {
  task: Task;
  showName?: boolean;
}) {
  const names = useMemberNames();
  if (task.assigned_user_id === null) {
    return showName ? (
      <span className="text-[13px] text-muted-foreground">Unassigned</span>
    ) : null;
  }
  const name = names.get(task.assigned_user_id) ?? "Teammate";
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <MemberAvatar name={name} />
      {showName && (
        <span className="truncate text-[13px] text-muted-foreground">
          {name}
        </span>
      )}
    </span>
  );
}
