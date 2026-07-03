import { format, isSameYear, isToday, isTomorrow } from "date-fns";

import type { Task } from "@/lib/api/types";

/**
 * Shared task display helpers. A task is quiet chrome (stone) except its title;
 * due dates go amber ONLY when overdue (never a red scare — APP-UI-ELEVATION
 * §2.1 / TASKS.md T6.1), and only for a not-done task (a done task is never
 * "overdue").
 */

/** A not-done task whose due date is in the past. */
export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.done || task.due_at === null) return false;
  return new Date(task.due_at).getTime() < now.getTime();
}

/**
 * A short, human due label for a chip/cell: "Today", "Tomorrow", "Jul 8",
 * "Jul 8 2027". Null due → "" (the caller renders nothing).
 */
export function formatDue(dueAt: string | null): string {
  if (dueAt === null) return "";
  const date = new Date(dueAt);
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isSameYear(date, new Date())) return format(date, "MMM d");
  return format(date, "MMM d yyyy");
}

/**
 * The deep-link back to a task's source message + conversation (TASKS.md T6.1):
 * `/inbox/[conversation]?message=[message]` — the thread scrolls/anchors to the
 * promoted message. Every view row links here.
 */
export function taskThreadHref(task: Pick<Task, "conversation_id" | "message_id">): string {
  return `/inbox/${task.conversation_id}?message=${task.message_id}`;
}
