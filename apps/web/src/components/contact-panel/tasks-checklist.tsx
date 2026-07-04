"use client";

import { Paperclip } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { InlineAssignee, InlineDue } from "@/components/tasks/task-inline-edit";
import { useTaskDrawer } from "@/components/tasks/use-task-drawer";
import { ApiError } from "@/lib/api/error";
import {
  useConversationTasks,
  useToggleTaskDone,
} from "@/lib/api/tasks";
import type { ChecklistTask } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * The conversation Tasks checklist (D17 / TASKS.md T5.2) — rendered in the
 * context panel's Tasks mount point. Lists the thread's live tasks
 * (`GET /v1/conversations/:id/tasks`); each row is a checkbox whose toggle
 * drives the DERIVED done via the SOURCE MESSAGE's `PATCH /v1/messages/:id
 * {done}` (T2 — never a task route). Because both this checkbox and the
 * in-thread D14 toggle write the same `messages.done_at`, checking a row also
 * strikes the source message through in the open thread, live, off the one
 * `message.status` broadcast.
 *
 * Calm rules (T5): done rows reuse the D14 treatment (line-through + 55%
 * opacity + the petrol check); assignee + due recede to stone; due is amber
 * ONLY when overdue (never a red scare); no count badge, no progress bar.
 * Optimistic with a 5s undo (the inverse `done` PATCH, itself a D14 no-op-safe
 * route). There is NO "+ Add task" here — tasks are created only by promoting a
 * message from its ⋯ menu (T0.1); the empty state teaches that.
 */
export function TasksChecklist({
  conversationId,
  /** Gate the fetch to when the panel is actually open. */
  active = true,
}: {
  conversationId: string;
  active?: boolean;
}) {
  const tasks = useConversationTasks(conversationId, { enabled: active });

  if (tasks.isPending) {
    return (
      <div className="space-y-2 px-2" aria-hidden>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (tasks.isError) {
    return (
      <p className="px-2 text-[13px] text-muted-foreground">
        Couldn&apos;t load tasks for this conversation.
      </p>
    );
  }

  const rows = tasks.data.data;

  if (rows.length === 0) {
    // First-run empty state teaches promotion (T5.3 discoverability) — the
    // checklist has no standalone add affordance by design.
    return (
      <p className="px-2 text-[13px] leading-relaxed text-muted-foreground">
        No tasks yet. Promote a message from its{" "}
        <span aria-hidden>⋯</span> menu to track it here.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {rows.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          conversationId={conversationId}
        />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  conversationId,
}: {
  task: ChecklistTask;
  conversationId: string;
}) {
  const toggle = useToggleTaskDone(conversationId);
  const { openTask } = useTaskDrawer();
  // Reflect the toggle optimistically at the row so the checkbox + strikethrough
  // move at click even before the checklist cache patch settles.
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const done = optimisticDone ?? task.done;

  const runToggle = (next: boolean) => {
    setOptimisticDone(next);
    toggle.mutate(
      { messageId: task.message_id, done: next },
      {
        onError: (error) => {
          setOptimisticDone(null);
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't update this task. Try again.",
          );
        },
        // The hook already patched the caches with the server row; drop the
        // local override so we render the authoritative state.
        onSuccess: () => setOptimisticDone(null),
      },
    );
    // Reversible + routine → quiet 5s undo (the inverse PATCH is a D14 no-op-safe
    // route). Only offered on mark-done, matching the calm one-undo contract.
    if (next) {
      undoableToast({
        message: "Task marked done",
        onUndo: () => runToggle(false),
      });
    }
  };

  return (
    <li className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
      <Checkbox
        checked={done}
        onCheckedChange={(value) => runToggle(value === true)}
        aria-label={done ? "Mark not done" : "Mark done"}
        // tap-target: ≥44px mobile hit area (G11 / §7). The Radix Checkbox is a
        // button and hosts the utility's centered ::after with no layout shift.
        className="tap-target mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => openTask(task.id)}
          className={cn(
            "block max-w-full truncate text-left text-[13px] font-medium text-foreground transition-[opacity,color] duration-150 ease-out hover:text-primary focus-visible:outline-none focus-visible:underline",
            // D14 done treatment: strikethrough + 55% opacity.
            done && "text-muted-foreground line-through opacity-55",
          )}
        >
          {task.title}
        </button>
        {/* D-B: inline quick-edits — assignee + due, without opening the
            drawer. D28: the trailing paperclip count is the DERIVED attachments
            union (source-message MMS + note files + legacy rows) — a quiet
            indicator, not an upload door; the task title opens the drawer,
            which lists the files and hosts the discussion composer. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <InlineAssignee task={task} />
          <InlineDue task={task} />
          {task.attachment_count > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
              title="Open the task to see its files"
            >
              <Paperclip className="size-3" strokeWidth={1.75} aria-hidden />
              {task.attachment_count}
              <span className="sr-only">
                {task.attachment_count === 1
                  ? "file on this task"
                  : "files on this task"}
              </span>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
