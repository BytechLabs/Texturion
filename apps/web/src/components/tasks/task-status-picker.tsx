"use client";

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { useT } from "@/i18n/provider";
import type { Task } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { taskThreadId } from "./task-format";
import { useTaskDone } from "./use-task-mutations";

type TaskStatus = "open" | "done";

/**
 * #743: the Status cell of a list row is the one control for changing a task's
 * status. Task rows carry no `allowed_actions`, and the task machine lets an
 * open task become done and a done task reopen, so the picker offers exactly
 * those two. The server still refuses what it must (the mutation rolls back).
 */
export function TaskStatusPicker({ task }: { task: Task }) {
  const t = useT();
  const done = useTaskDone();
  const current: TaskStatus = task.done ? "done" : "open";
  const labels: Record<TaskStatus, string> = {
    open: t("tasks.statusOpen"),
    done: t("tasks.statusDone"),
  };

  function move(next: TaskStatus) {
    if (next === current) return;
    const send = (toDone: boolean) =>
      done.mutate({
        taskId: task.id,
        messageId: task.message_id,
        conversationId: taskThreadId(task),
        done: toDone,
      });
    send(next === "done");
    // The mutation's own onError already toasts a failure; the undo toast is
    // for a change that is applied optimistically.
    undoableToast({
      message:
        next === "done" ? t("tasks.statusChangedDone") : t("tasks.statusChangedOpen"),
      undoLabel: t("thread.undo"),
      onUndo: () => send(current === "done"),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("tasks.statusChangeAria", {
            title: task.title,
            status: labels[current],
          })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            task.done
              ? "bg-success/10 text-emerald-700 hover:bg-success/20 dark:bg-success/15 dark:text-success"
              : "bg-secondary text-stone-600 hover:bg-secondary/70 dark:text-muted-foreground",
          )}
        >
          {labels[current]}
          <ChevronDown className="size-3" strokeWidth={2} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => move(value as TaskStatus)}
        >
          <DropdownMenuRadioItem value="open">{labels.open}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="done">{labels.done}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
