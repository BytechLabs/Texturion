"use client";

import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MemberAvatar } from "@/components/inbox/member-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/lib/api/me";
import { useUpdateTask } from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type { Task } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { isOverdue } from "./task-format";

/** Sentinel <Select> value for "unassigned" (Radix forbids an empty string). */
const UNASSIGNED = "__unassigned__";

/**
 * Inline quick-edits (TASKS-V2 D-B) — assignee and due editable directly on a
 * /tasks list row and in the conversation checklist WITHOUT opening the drawer.
 * Both wire the existing `useUpdateTask` (optimistic + rollback). `conversationId`
 * scopes the checklist/thread invalidation to the task's own thread.
 */

/** A compact assignee picker: the avatar/name is the trigger; a Select edits it. */
export function InlineAssignee({ task }: { task: Task }) {
  const me = useMe();
  const members = useMembers();
  const update = useUpdateTask(task.conversation_id);
  const memberOptions = members.data?.data ?? [];
  const value = task.assigned_user_id ?? UNASSIGNED;
  const name =
    task.assigned_user_id !== null
      ? memberOptions.find((m) => m.user_id === task.assigned_user_id)
          ?.display_name ?? "Teammate"
      : null;

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        update.mutate(
          {
            taskId: task.id,
            assigned_user_id: next === UNASSIGNED ? null : next,
          },
          { onError: () => toast.error("Couldn't reassign this task.") },
        )
      }
    >
      <SelectTrigger
        aria-label="Assignee"
        className="h-auto min-h-8 w-auto gap-1.5 border-none bg-transparent px-1.5 py-1 text-[13px] shadow-none hover:bg-app-stone-1 focus-visible:ring-2 focus-visible:ring-ring/50 data-[size=default]:h-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {name ? (
          <span className="flex items-center gap-1.5">
            <MemberAvatar name={name} className="size-4" />
            <span className="truncate text-app-muted">{name}</span>
          </span>
        ) : (
          <SelectValue placeholder="Unassigned" />
        )}
      </SelectTrigger>
      {/* #123: popper position (not the default item-aligned) so Radix's
          collision detection FLIPS the list above the trigger when it sits low
          in a bottom sheet — item-aligned rendered it off the bottom edge of
          the phone viewport, which read as "the dropdown won't open". */}
      <SelectContent
        position="popper"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {memberOptions.map((member) => (
          <SelectItem key={member.id} value={member.user_id}>
            {member.display_name}
            {me.data?.user_id === member.user_id ? " (you)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A compact due-date editor: the due chip opens a datetime popover. */
export function InlineDue({ task }: { task: Task }) {
  const update = useUpdateTask(task.conversation_id);
  const [open, setOpen] = useState(false);
  const overdue = isOverdue(task);

  const label =
    task.due_at !== null ? format(new Date(task.due_at), "MMM d, h:mm a") : "Set due";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            task.due_at
              ? overdue
                ? "Change due date (overdue)"
                : "Change due date"
              : "Set due date"
          }
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "tap-target inline-flex items-center gap-1 rounded-app-ctrl px-1.5 py-1 text-[12px] tabular-nums transition-colors hover:bg-app-stone-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
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
            defaultValue={toLocalInput(task.due_at)}
            onChange={(e) =>
              update.mutate(
                {
                  taskId: task.id,
                  due_at:
                    e.target.value === ""
                      ? null
                      : new Date(e.target.value).toISOString(),
                },
                { onError: () => toast.error("Couldn't change the due date.") },
              )
            }
            className="rounded-app-ctrl border border-app-line bg-app-white px-2 py-1.5 text-[13px] text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {task.due_at !== null && (
            <button
              type="button"
              onClick={() => {
                update.mutate(
                  { taskId: task.id, due_at: null },
                  { onError: () => toast.error("Couldn't clear the due date.") },
                );
                setOpen(false);
              }}
              className="tap-target self-start rounded-app-ctrl px-1 py-0.5 text-[12px] font-medium text-app-muted hover:text-app-ink"
            >
              Clear due date
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
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
