import { format, isSameYear, isToday, isTomorrow } from "date-fns";

import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { Task } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/**
 * #228: English, for a caller that has not been extracted yet.
 *
 * It reads the CATALOGUE rather than a literal, so there is only ever one place
 * "Today" is written down. Built once at module load — `formatDue` runs per row
 * in four views, and rebuilding the lookup on every call would make a copy
 * change into a render cost.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

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
 *
 * `t` defaults to English so a call site outside the tasks slice keeps
 * compiling and keeps saying exactly what it said before. Pass the reader's own
 * `t` to get their language.
 */
export function formatDue(dueAt: string | null, t: Translate = EN): string {
  if (dueAt === null) return "";
  const date = new Date(dueAt);
  if (isToday(date)) return t("tasks.today");
  if (isTomorrow(date)) return t("tasks.tomorrow");
  if (isSameYear(date, new Date())) return format(date, "MMM d");
  return format(date, "MMM d yyyy");
}

/**
 * The deep-link back to a task's source message + conversation (TASKS.md T6.1):
 * `/inbox/[conversation]?message=[message]` — the thread scrolls/anchors to the
 * promoted message. Every view row links here.
 */
/**
 * Who rang, for a task promoted from a call (D64): the CNAM name, else the
 * formatted number, else the caller-unknown line. Null for a message task.
 */
export function taskCallerName(
  task: Pick<Task, "call">,
  t: Translate,
): string | null {
  const call = task.call;
  if (!call) return null;
  if (call.caller_name) return call.caller_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return t("shell.unknownCaller");
}

export function taskThreadHref(task: Pick<Task, "conversation_id" | "message_id">): string {
  // A task promoted from a call has no message to anchor to (D64): the thread.
  return task.message_id === null
    ? `/inbox/${task.conversation_id}`
    : `/inbox/${task.conversation_id}?message=${task.message_id}`;
}
