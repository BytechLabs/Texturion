import { format } from "date-fns";

import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/** English, for a caller that has not been extracted yet. See `formatDue`. */
const EN = makeTranslate(DEFAULT_LOCALE);

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
 *
 * #228: the actor is INTERPOLATED rather than concatenated, so a language that
 * does not put the subject first has somewhere to put it. `t` is last and
 * defaults to English, because the thread's system lines share this function
 * and have not been extracted yet.
 */
export function taskEventSentence(
  event: TaskEventLike,
  by: string,
  memberName: (userId: string | null) => string | null,
  t: Translate = EN,
): string | null {
  switch (event.type) {
    case "task_created":
      return t("tasks.eventCreated", { by });
    case "task_assigned": {
      const to =
        typeof event.payload.to_user_id === "string"
          ? event.payload.to_user_id
          : null;
      if (!to) return t("tasks.eventUnassigned", { by });
      const name = memberName(to);
      return name
        ? t("tasks.eventAssigned", { by, name })
        : t("tasks.eventReassigned", { by });
    }
    case "task_due_set": {
      const due =
        typeof event.payload.due_at === "string" ? event.payload.due_at : null;
      if (!due) return t("tasks.eventDueCleared", { by });
      return t("tasks.eventDueSet", { by, due: formatDue(due, t) });
    }
    case "task_deleted":
      return t("tasks.eventDeleted", { by });
    case "task_attachment_added":
      return t("tasks.eventAttachmentAdded", { by });
    case "task_attachment_removed":
      return t("tasks.eventAttachmentRemoved", { by });
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
function formatDue(iso: string, t: Translate): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = format(date, "h:mm a");
  if (sameDay) return t("tasks.eventDueToday", { time });
  return `${format(date, "MMM d")} ${time}`;
}
