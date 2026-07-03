"use client";

import { format, isSameYear } from "date-fns";
import { ChevronDown, Paperclip } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AttachmentsSection } from "@/components/attachments/attachments-section";
import { useMemberNames, MemberAvatar } from "@/components/inbox/member-avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { undoableToast } from "@/components/ui/optimistic-undo";
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

/**
 * Due-date label for a checklist row: compact and tabular. Same-year dates drop
 * the year ("Jul 8"); older/other years keep it ("Jul 8 2025"). `overdue` is
 * computed against `now` and only ever true for a NOT-done task (a done task is
 * never overdue — completion clears the pressure, matching the list view).
 */
export function dueLabel(
  dueAt: string,
  done: boolean,
  now: Date = new Date(),
): { text: string; overdue: boolean } {
  const date = new Date(dueAt);
  const text = isSameYear(date, now)
    ? format(date, "MMM d")
    : format(date, "MMM d yyyy");
  return { text, overdue: !done && date.getTime() < now.getTime() };
}

function TaskRow({
  task,
  conversationId,
}: {
  task: ChecklistTask;
  conversationId: string;
}) {
  const toggle = useToggleTaskDone(conversationId);
  const memberNames = useMemberNames();
  // Reflect the toggle optimistically at the row so the checkbox + strikethrough
  // move at click even before the checklist cache patch settles.
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const done = optimisticDone ?? task.done;

  // D19: task attachments (owner_type='task') — a quiet per-row disclosure. The
  // checklist row carries `attachment_count`, so the toggle can show the count
  // without fetching; the list only fetches when the row is expanded.
  const [filesOpen, setFilesOpen] = useState(false);

  const assigneeName = task.assigned_user_id
    ? memberNames.get(task.assigned_user_id) ?? null
    : null;
  const due = task.due_at ? dueLabel(task.due_at, done) : null;

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
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] font-medium text-foreground transition-[opacity] duration-150 ease-out",
            // D14 done treatment: strikethrough + 55% opacity.
            done && "text-muted-foreground line-through opacity-55",
          )}
        >
          {task.title}
        </p>
        {(assigneeName || due) && (
          <div className="mt-0.5 flex items-center gap-2">
            {assigneeName && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <MemberAvatar name={assigneeName} className="size-4" />
                <span className="text-[11px]">{assigneeName}</span>
              </span>
            )}
            {due && (
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  due.overdue
                    ? "text-amber-700 dark:text-warning"
                    : "text-muted-foreground",
                )}
              >
                {due.text}
              </span>
            )}
          </div>
        )}
        {/* D19: attach-a-file affordance + existing task attachments. The
            "Files (N)" toggle recedes to stone; opening it mounts the shared
            AttachmentsSection which fetches this task's attachments and offers
            the attach button (25 MB, any allowed type). */}
        <button
          type="button"
          onClick={() => setFilesOpen((value) => !value)}
          aria-expanded={filesOpen}
          className="tap-target mt-1 flex items-center gap-1 rounded-md px-0.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          <Paperclip className="size-3" strokeWidth={1.75} aria-hidden />
          {task.attachment_count > 0 ? `Files (${task.attachment_count})` : "Files"}
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-150 ease-out",
              filesOpen && "rotate-180",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        {filesOpen && (
          <div className="mt-1.5">
            <AttachmentsSection
              ownerType="task"
              ownerId={task.id}
              compact
            />
          </div>
        )}
      </div>
    </li>
  );
}
