"use client";

import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useT } from "@/i18n/provider";
import { useUpdateTask } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { AssigneeField } from "./assignee-field";
import { taskAssigneeIds } from "./task-assignees";
import { isOverdue, taskThreadId } from "./task-format";

/**
 * Inline quick-edits (TASKS-V2 D-B) — assignee and due editable directly on a
 * /tasks list row and in the conversation checklist WITHOUT opening the drawer.
 * Both wire the existing `useUpdateTask` (optimistic + rollback). `conversationId`
 * scopes the checklist/thread invalidation to the task's own thread.
 */

/** A compact assignee picker: the stacked avatars are the trigger; a checklist edits the crew. */
export function InlineAssignee({ task }: { task: Task }) {
  const t = useT();
  const update = useUpdateTask(taskThreadId(task));
  return (
    <AssigneeField
      compact
      ariaLabel={t("tasks.assignee")}
      value={taskAssigneeIds(task)}
      onCommit={(ids) =>
        update.mutate(
          { taskId: task.id, assignee_ids: ids },
          { onError: () => toast.error(t("tasks.reassignFailed")) },
        )
      }
    />
  );
}

/** A compact due-date editor: the due chip opens a datetime popover. */
export function InlineDue({ task }: { task: Task }) {
  const t = useT();
  const update = useUpdateTask(taskThreadId(task));
  const [open, setOpen] = useState(false);
  const overdue = isOverdue(task);

  const label =
    task.due_at !== null
      ? format(new Date(task.due_at), "MMM d, h:mm a")
      : t("tasks.setDue");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            task.due_at
              ? overdue
                ? t("tasks.changeDueOverdueAria")
                : t("tasks.changeDueAria")
              : t("tasks.setDueAria")
          }
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "tap-target inline-flex items-center gap-1 rounded-app-ctrl px-1.5 py-1 text-[12px] tabular-nums transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            task.due_at === null && "text-app-muted-2",
            overdue ? "font-medium text-warning" : "text-app-muted",
          )}
        >
          <CalendarClock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <input
            type="datetime-local"
            aria-label={t("tasks.dueDateTimeAria")}
            defaultValue={toLocalInput(task.due_at)}
            onChange={(e) => {
              // A datetime-local reads "" while ANY segment is blank, so
              // clearing the hour to retype it looked like "remove the due
              // date" and wrote that immediately. Removing one is the explicit
              // control below.
              if (e.target.value === "") return;
              update.mutate(
                {
                  taskId: task.id,
                  due_at: new Date(e.target.value).toISOString(),
                },
                { onError: () => toast.error(t("tasks.dueChangeFailed")) },
              );
            }}
            className="rounded-app-ctrl border border-app-line bg-app-paper px-2 py-1.5 text-[13px] text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {task.due_at !== null && (
            <button
              type="button"
              onClick={() => {
                update.mutate(
                  { taskId: task.id, due_at: null },
                  { onError: () => toast.error(t("tasks.dueClearFailed")) },
                );
                setOpen(false);
              }}
              className="tap-target self-start rounded-app-ctrl px-1 py-0.5 text-[12px] font-medium text-app-muted hover:text-app-ink"
            >
              {t("tasks.clearDueDate")}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** ISO instant → the local wall-clock string a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  // An unparseable due_at makes `local` an Invalid Date whose toISOString()
  // throws RangeError — guard to a blank input instead (matches isoToLocalInput).
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
