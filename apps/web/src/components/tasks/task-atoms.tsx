"use client";

import { taskNumberLabel } from "@loonext/shared";
import { Check } from "lucide-react";

import { useMemberNames } from "@/components/inbox/member-avatar";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/types";

import { AssigneeStack, assigneeSummary } from "./assignee-field";
import { assigneeNames } from "./task-assignees";
import { formatDue, isOverdue, taskThreadId } from "./task-format";
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
  const t = useT();
  const done = useTaskDone();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? t("tasks.markNotDone") : t("tasks.markDone")}
      // Guard against a double-submit while the derived PATCH is in flight —
      // matching the for-you TaskRow checkbox, the same message-done write (#4).
      disabled={done.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        done.mutate({
          taskId: task.id,
          messageId: task.message_id,
          conversationId: taskThreadId(task),
          done: !task.done,
        });
      }}
      className={cn(
        "tap-target flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
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

/** #690: the workspace's short number for a task, "T-142". Nothing for a row from before numbers. */
export function TaskNumber({
  task,
  className,
}: {
  task: Pick<Task, "number">;
  className?: string;
}) {
  if (task.number === undefined) return null;
  return (
    <span className={cn("shrink-0 tabular-nums text-xs text-muted-foreground", className)}>
      {taskNumberLabel(task.number)}
    </span>
  );
}

/** The derived-status pill (T6.1): quiet stone for open, success tint for done. */
export function TaskStatusPill({ task }: { task: Task }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        task.done
          ? "bg-success/10 text-emerald-700 dark:bg-success/15 dark:text-success"
          : "bg-secondary text-stone-600 dark:text-muted-foreground",
      )}
    >
      {task.done ? t("tasks.statusDone") : t("tasks.statusOpen")}
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
  // Before the early return: a hook cannot be called conditionally, and the
  // `due_at === null` guard below returns first for an undated task.
  const t = useT();
  if (task.due_at === null) return null;
  const overdue = isOverdue(task);
  return (
    <span
      className={cn(
        "tabular-nums",
        overdue ? "font-medium text-warning" : "text-muted-foreground",
        className,
      )}
      title={overdue ? t("tasks.overdue") : undefined}
    >
      {/* Overdue is otherwise color-only (WCAG 1.4.1) — give SR/color-blind
          users a text signal without changing the visual. */}
      {overdue && (
        <span className="sr-only">{t("tasks.overdueSrPrefix")}</span>
      )}
      {formatDue(task.due_at, t)}
    </span>
  );
}

/** The assignee cell (T6.1): stacked avatars + a short name, or a quiet "Unassigned". */
export function TaskAssignee({
  task,
  showName = true,
}: {
  task: Task;
  showName?: boolean;
}) {
  const t = useT();
  const roster = useMemberNames();
  const names = assigneeNames(task, roster, t("tasks.teammate"));
  if (names.length === 0) {
    return showName ? (
      <span className="text-[13px] text-muted-foreground">
        {t("tasks.unassigned")}
      </span>
    ) : null;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <AssigneeStack names={names} />
      {showName && (
        <span className="truncate text-[13px] text-muted-foreground">
          {assigneeSummary(names, t)}
        </span>
      )}
    </span>
  );
}
