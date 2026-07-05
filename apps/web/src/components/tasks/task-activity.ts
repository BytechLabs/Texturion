import { format } from "date-fns";

/**
 * Human-language copy for the task_* conversation events (TASKS-V2 D-C). Shared
 * by the thread's interwoven system lines (system-line.tsx) and the task
 * drawer's activity timeline (task-detail-panel.tsx) so the two never drift.
 * Plain language, no em-dashes (repo rule). The payload shapes are the ones the
 * task-mutation RPCs write (20260702090000_appv2_task_mutations.sql):
 *   task_created   { task_id, message_id }
 *   task_assigned  { task_id, from_user_id, to_user_id }
 *   task_due_set   { task_id, due_at }        (due_at null = the due date cleared)
 *   task_deleted   { task_id }
 * plus the D19 task attachment add/remove events.
 */

/** The minimal event shape both call sites can supply. */
export interface TaskEventLike {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * A quiet sentence for a task event, with the actor's name. `by` is the
 * resolved actor (or a fallback like "Loonext"); `memberName` resolves a user
 * id to a display name for the "assigned to <name>" line. Unknown types return
 * null so the caller can skip rendering.
 */
export function taskEventSentence(
  event: TaskEventLike,
  by: string,
  memberName: (userId: string | null) => string | null,
): string | null {
  switch (event.type) {
    case "task_created":
      return `${by} turned this into a task`;
    case "task_assigned": {
      const to =
        typeof event.payload.to_user_id === "string"
          ? event.payload.to_user_id
          : null;
      if (!to) return `${by} unassigned this task`;
      const name = memberName(to);
      return name ? `${by} assigned this to ${name}` : `${by} reassigned this task`;
    }
    case "task_due_set": {
      const due =
        typeof event.payload.due_at === "string" ? event.payload.due_at : null;
      if (!due) return `${by} cleared the due date`;
      return `${by} set the due date to ${formatDue(due)}`;
    }
    case "task_deleted":
      return `${by} removed this task`;
    case "task_attachment_added":
      return `${by} attached a file`;
    case "task_attachment_removed":
      return `${by} removed a file`;
    default:
      return null;
  }
}

/** True for a task_* event type (drives whether a link/sentence applies). */
export function isTaskEventType(type: string): boolean {
  return (
    type === "task_created" ||
    type === "task_assigned" ||
    type === "task_due_set" ||
    type === "task_deleted" ||
    type === "task_attachment_added" ||
    type === "task_attachment_removed"
  );
}

/** "today 3:00 PM" / "Jul 8 9:00 AM" for a due-set line. */
function formatDue(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = format(date, "h:mm a");
  if (sameDay) return `today ${time}`;
  return `${format(date, "MMM d")} ${time}`;
}
