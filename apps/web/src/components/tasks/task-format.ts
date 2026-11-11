import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { Task, TaskSourceCall, TaskSourceMessage } from "@/lib/api/types";
import { threadHref } from "@/lib/inbox/thread-href";
import { formatPhone } from "@/lib/format/phone";
import { formatTimestamp } from "@/lib/format/time";

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
 * The due label for a string context, from the shared timestamp rule: "3:42 PM",
 * "Tomorrow 3:42 PM", "Jul 8, 3:42 PM". Null due → "" (the caller renders
 * nothing). A chip draws `<Timestamp>` instead, so it can be hovered.
 *
 * `t` defaults to English so a call site outside the tasks slice keeps
 * compiling and keeps saying exactly what it said before. Pass the reader's own
 * `t` to get their language.
 */
export function formatDue(dueAt: string | null, t: Translate = EN): string {
  if (dueAt === null) return "";
  return formatTimestamp(dueAt, { style: "long", t });
}

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

/**
 * The conversation id the caches and mutations key a task on. A task with no
 * conversation (#689) has no thread caches, so it gets a key nothing else uses.
 */
export const NO_CONVERSATION = "no-conversation";

/**
 * #722: whether the server's list offers this member `action` on the task. A
 * surface that holds no list (the field is absent) keeps its own behaviour.
 */
export function taskActionAllowed(
  task: Pick<Task, "allowed_actions">,
  action: "complete" | "reopen" | "trash",
): boolean {
  return task.allowed_actions?.includes(action) ?? true;
}

export function taskThreadId(task: Pick<Task, "conversation_id">): string {
  return task.conversation_id ?? NO_CONVERSATION;
}

/** The slice of a task the source link reads; list rows carry less than the detail. */
type SourceLinkTask = Pick<Task, "id" | "conversation_id" | "message_id"> & {
  source?: Task["source"];
  source_call_id?: string | null;
  call?: TaskSourceCall | null;
  source_call?: TaskSourceCall | null;
  source_message?: Pick<TaskSourceMessage, "direction"> | null;
  contact?: { name: string | null } | null;
};

export interface TaskSourceLink {
  kind: "text" | "call" | "note";
  /** Names the source: "From a text from Sam". */
  label: string;
  /** The thread at the source, with this task open beside it. */
  href: string;
}

/**
 * #718: the link from a task back to where it came from, or null.
 *
 * A source link exists only when the source does, and it names that source. A
 * standalone task has none, so no view can print "Open conversation" for a
 * conversation that is not there. A message source lands on the message, a call
 * source on the call's line in the thread, and both open this task beside it.
 *
 * `besideTask: false` leaves the task out, for a screen too narrow to dock it:
 * there the task opens as a drawer over the thread and would hide the very
 * message the link was followed to see.
 */
export function taskSourceLink(
  task: SourceLinkTask,
  t: Translate,
  { besideTask = true }: { besideTask?: boolean } = {},
): TaskSourceLink | null {
  const conversationId = task.conversation_id;
  const taskId = besideTask ? task.id : null;
  if (conversationId === null) return null;

  const call = task.source_call ?? task.call ?? null;
  if (task.source?.kind === "call" || task.source_call_id || call) {
    const name = call ? taskCallerName({ call }, t) : null;
    return {
      kind: "call",
      label: t("tasks.linkFromCall", { name: name ?? t("shell.unknownCaller") }),
      href: threadHref(conversationId, {
        callSessionId: call?.call_session_id ?? null,
        taskId,
      }),
    };
  }

  if (task.message_id === null) return null;
  const href = threadHref(conversationId, {
    messageId: task.message_id,
    taskId,
  });
  if (task.source_message?.direction === "note" || task.source?.direction === "note") {
    return { kind: "note", label: t("tasks.linkNote"), href };
  }
  const name = task.contact?.name?.trim();
  return {
    kind: "text",
    label: name
      ? t("tasks.linkFromText", { name })
      : t("tasks.linkFromTextUnnamed"),
    href,
  };
}
