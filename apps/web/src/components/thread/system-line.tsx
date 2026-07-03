"use client";

import type { ConversationEvent } from "@/lib/api/types";

import { statusLabel } from "@/components/inbox/status-pill";
import { isTaskEventType, taskEventSentence } from "@/components/tasks/task-activity";
import { useTaskDrawer } from "@/components/tasks/use-task-drawer";
import type { ConversationStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { doneEventSentence } from "./done";

/** Day divider (mockup .daymark): a centered bordered stone chip, not a rule. */
export function DayDivider({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-1.5"
      role="separator"
      aria-label={label}
    >
      <span className="rounded-full border border-app-line bg-app-stone-0 px-3 py-[3px] text-[11px] font-semibold text-app-muted-2">
        {label}
      </span>
    </div>
  );
}

/**
 * Timeline event copy (G5: centered 12px stone-400 system lines with the
 * actor's name; G10 plain language). `messageBody` resolves a message id to
 * its live body for the §4.3 done/undone lines — it is joined at render time,
 * never stored in the event payload.
 */
export function eventSentence(
  event: ConversationEvent,
  memberName: (userId: string | null) => string | null,
  messageBody: (messageId: string) => string | undefined = () => undefined,
): string {
  const actor = memberName(event.actor_user_id);
  const by = actor ?? "JobText";
  switch (event.type) {
    case "status_changed": {
      const to = event.payload.to as ConversationStatus | undefined;
      if (to === "closed") return `${by} closed this conversation`;
      if (event.payload.from === "closed") {
        return `${by} reopened this conversation`;
      }
      return to
        ? `${by} marked this ${statusLabel(to).toLowerCase()}`
        : `${by} changed the status`;
    }
    case "assigned": {
      const to = event.payload.to as string | null | undefined;
      if (!to) return `${by} unassigned this conversation`;
      const assignee = memberName(to);
      return assignee
        ? `${by} assigned this to ${assignee}`
        : `${by} assigned this conversation`;
    }
    case "tag_added": {
      const name = event.payload.name;
      return typeof name === "string"
        ? `${by} added the tag “${name}”`
        : `${by} added a tag`;
    }
    case "tag_removed":
      return `${by} removed a tag`;
    case "opted_out":
      return actor
        ? `${actor} marked this customer as opted out`
        : "This customer opted out of texting";
    case "opt_out_revoked":
      return actor
        ? `${actor} marked this customer as opted in`
        : "This customer opted back in";
    case "consent_attested":
      return `${by} recorded that this customer asked to be texted`;
    case "quiet_hours_confirmed":
      return `${by} sent during this customer's quiet hours`;
    case "spam_marked":
      return `${by} marked this conversation as spam`;
    case "spam_unmarked":
      return `${by} unmarked spam`;
    // §4.2/§4.3: done audit. The body is joined live from the message the
    // event points at (payload.message_id) — never a stored excerpt.
    case "message_done":
    case "message_undone": {
      const messageId =
        typeof event.payload.message_id === "string"
          ? event.payload.message_id
          : null;
      return doneEventSentence(
        event,
        by,
        messageId ? messageBody(messageId) : undefined,
      );
    }
    // TASKS-V2 D-C: task lifecycle interwoven in the thread as quiet system
    // lines (e.g. "Jordan turned this into a task", "assigned to Marcus",
    // "due today 3:00 PM", "task removed"). Shared copy with the drawer.
    case "task_created":
    case "task_assigned":
    case "task_due_set":
    case "task_deleted":
    case "task_attachment_added":
    case "task_attachment_removed":
      return taskEventSentence(event, by, memberName) ?? `${by} updated a task`;
    // D19 note-attachment audit — a quiet line matching the task attachment copy.
    case "note_attachment_added":
      return `${by} attached a file to a note`;
    case "note_attachment_removed":
      return `${by} removed a file from a note`;
  }
}

export function SystemLine({
  event,
  memberName,
  messageBody,
}: {
  event: ConversationEvent;
  memberName: (userId: string | null) => string | null;
  /** Resolve a message id → its live body for §4.3 done/undone lines. */
  messageBody?: (messageId: string) => string | undefined;
}) {
  const { openTask } = useTaskDrawer();
  const sentence = eventSentence(event, memberName, messageBody);

  // TASKS-V2 D-C: a task line links to open the task drawer (`?task=<id>`).
  // Every task_* event carries payload.task_id. A task_deleted line stays plain
  // text (the task no longer exists to open).
  const taskId =
    typeof event.payload.task_id === "string" ? event.payload.task_id : null;
  const openable =
    isTaskEventType(event.type) && event.type !== "task_deleted" && taskId;

  if (openable) {
    return (
      <p className="py-1 text-center text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => openTask(taskId)}
          className={cn(
            "tap-target rounded-full px-1 underline-offset-2 transition-colors",
            "hover:text-app-petrol hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          {sentence}
        </button>
      </p>
    );
  }

  return (
    // §3.2: timeline events are quiet by design — centered 12px, recede to
    // stone-500. (The spec's "stone-400" tertiary target fails AA at 2.5:1 as
    // read-for-meaning text; §6 mandates stone-500 where meta carries meaning.)
    <p className="py-1 text-center text-xs text-muted-foreground">{sentence}</p>
  );
}
