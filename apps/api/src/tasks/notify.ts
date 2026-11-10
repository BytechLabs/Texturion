/**
 * Task subscriber notifications (#689 D, D150).
 *
 * A push to everyone who follows a task, never to the person who made the
 * change, when a task is unassigned from someone, has its time changed, is
 * completed or reopened, gets a comment, or names somebody in a comment.
 *
 * WHO: `task_subscribers` rows with no `unsubscribed_at` (the creator, the
 * assignee, commenters, the mentioned, and anyone who pressed Follow), minus the
 * actor. A comment's mentioned people get the mention alert instead of the
 * comment alert, so nobody is told twice about one sentence.
 *
 * ACCESS is re-checked here, not trusted from the route, for the reason
 * `notifyAssigned` re-checks it: membership and number access change between a
 * write and this running, and the alert carries a task title. A member denied
 * the number a task's conversation sits on is simply not told (#106), and a
 * deactivated member never is.
 *
 * COLLAPSE: rapid edits by one person on one task push once per 60 seconds per
 * recipient and kind. The claim is `task_notify_claim`, one SQL statement, so it
 * holds across Worker isolates; this process keeps no state. It runs LAST, after
 * every filter, so a person who would not have been told never spends a window.
 *
 * PUSH ONLY, best-effort: the route has already saved the change. Callers catch.
 */
import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "../notifications/deliver";
import { notificationSnippet } from "../notifications/inbound";
import { THREAD_PUSH_COPY } from "../notifications/thread-copy";
import { TASK_NOTIFY_COPY } from "./notify-copy";

/** Keep the body to a notification-shade line rather than a wall of text. */
const TITLE_LENGTH = 80;

/** Edits by one person to one task inside this window push once. */
export const TASK_NOTIFY_WINDOW_SECONDS = 60;

export type TaskChangeKind =
  | "unassigned"
  | "due_changed"
  | "completed"
  | "reopened"
  | "comment"
  | "mentioned";

export interface TaskChange {
  companyId: string;
  taskId: string;
  /** Who made the change. Never notified about it. */
  actorUserId: string;
  kind: TaskChangeKind;
  /** `unassigned`: the person taken off the task. */
  previousAssigneeId?: string | null;
  /** `comment` and `mentioned`: the people the comment names. */
  mentionedUserIds?: string[];
  /** `comment` and `mentioned`: what was written. */
  commentBody?: string;
}

interface TaskRow {
  id: string;
  title: string | null;
  conversation_id: string | null;
  deleted_at: string | null;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/** Where a tap lands: the job over its thread, or its own page. */
export function taskLink(
  origin: string,
  task: { id: string; conversation_id: string | null },
): string {
  return task.conversation_id
    ? `${origin}/inbox/${task.conversation_id}?task=${task.id}`
    : `${origin}/tasks/${task.id}`;
}

/**
 * Of these members, the ones who may see a task: active, and (when the task
 * hangs off a thread) not denied that thread's number (#106). A task with no
 * thread is visible to every active member (D148).
 */
export async function filterToTaskViewers(
  db: SupabaseClient,
  companyId: string,
  conversationId: string | null,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  if (conversationId !== null) {
    const conversations = unwrapRows<{ phone_number_id: string | null }>(
      await db
        .from("conversations")
        .select("phone_number_id")
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .limit(1),
      "conversation lookup",
    );
    const conversation = conversations[0];
    if (!conversation) return [];
    const viewers = await listConversationViewers(db, {
      companyId,
      phoneNumberId: conversation.phone_number_id,
    });
    const canSee = new Set(viewers.map((row) => row.user_id));
    return userIds.filter((id) => canSee.has(id));
  }
  const members = unwrapRows<{ user_id: string }>(
    await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", userIds)
      .is("deactivated_at", null),
    "task audience membership lookup",
  );
  const active = new Set(members.map((row) => row.user_id));
  return userIds.filter((id) => active.has(id));
}

/** The people who should hear about this change, before any access check. */
async function candidates(
  db: SupabaseClient,
  change: TaskChange,
): Promise<string[]> {
  const mentioned = [...new Set(change.mentionedUserIds ?? [])];
  if (change.kind === "mentioned") {
    // Named directly, and `task_subscribe` has already lifted any unfollow.
    return mentioned.filter((id) => id !== change.actorUserId);
  }

  const subscribers = unwrapRows<{ user_id: string }>(
    await db
      .from("task_subscribers")
      .select("user_id")
      .eq("company_id", change.companyId)
      .eq("task_id", change.taskId)
      .is("unsubscribed_at", null),
    "task subscribers lookup",
  ).map((row) => row.user_id);

  if (change.kind === "unassigned") {
    const former = change.previousAssigneeId;
    return former && former !== change.actorUserId && subscribers.includes(former)
      ? [former]
      : [];
  }

  return subscribers.filter(
    (id) =>
      id !== change.actorUserId &&
      !(change.kind === "comment" && mentioned.includes(id)),
  );
}

export async function notifyTaskChange(
  env: Env,
  change: TaskChange,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const tasks = unwrapRows<TaskRow>(
    await db
      .from("tasks")
      .select("id,title,conversation_id,deleted_at")
      .eq("company_id", change.companyId)
      .eq("id", change.taskId)
      .limit(1),
    "task lookup",
  );
  const task = tasks[0];
  if (!task || task.deleted_at !== null) return;

  let audience = await candidates(db, change);
  if (audience.length === 0) return;

  audience = await filterToTaskViewers(
    db,
    change.companyId,
    task.conversation_id,
    audience,
  );
  if (audience.length === 0) return;

  const prefRows = unwrapRows<{ user_id: string; push_enabled: boolean }>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", change.companyId)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const pushOff = new Set(
    prefRows.filter((row) => row.push_enabled === false).map((row) => row.user_id),
  );
  audience = audience.filter((id) => !pushOff.has(id));
  if (audience.length === 0) return;

  const { data: won, error: claimError } = await db.rpc("task_notify_claim", {
    p_company_id: change.companyId,
    p_task_id: change.taskId,
    p_actor_user_id: change.actorUserId,
    p_kind: change.kind,
    p_recipients: audience,
    p_window_seconds: TASK_NOTIFY_WINDOW_SECONDS,
  });
  if (claimError) {
    throw new Error(`task_notify_claim failed: ${claimError.message}`);
  }
  const recipients = (won ?? []) as string[];
  if (recipients.length === 0) return;

  const actors = unwrapRows<{ display_name: string | null }>(
    await db
      .from("profiles")
      .select("display_name")
      .eq("user_id", change.actorUserId)
      .limit(1),
    "task actor lookup",
  );
  const actorName = actors[0]?.display_name?.trim() || null;
  const authored = (task.title ?? "").trim().slice(0, TITLE_LENGTH);
  const isComment = change.kind === "comment" || change.kind === "mentioned";

  const headline = (locale: Locale): string => {
    const copy = TASK_NOTIFY_COPY[locale];
    const actor = actorName ?? THREAD_PUSH_COPY[locale].teammateFallback;
    switch (change.kind) {
      case "unassigned":
        return copy.unassignedTitle(actor);
      case "due_changed":
        return copy.dueChangedTitle(actor);
      case "completed":
        return copy.completedTitle(actor);
      case "reopened":
        return copy.reopenedTitle(actor);
      case "comment":
        return copy.commentTitle(actor);
      case "mentioned":
        return copy.mentionedTitle(actor);
    }
  };
  // A comment shows the comment; every other change shows which task.
  const line = (locale: Locale): string =>
    isComment
      ? notificationSnippet(change.commentBody ?? "", 0, locale)
      : authored || TASK_NOTIFY_COPY[locale].taskFallback;
  const url = taskLink(env.APP_ORIGIN, task);
  const payload = (locale: Locale) => ({
    title: headline(locale),
    body: line(locale),
    url,
  });

  const failures: unknown[] = [];
  await deliverPush(env, db, {
    category: change.kind === "mentioned" ? "mentions" : "tasks",
    companyId: change.companyId,
    userIds: recipients,
    // #430: the task title and a comment are members' words. The headline,
    // which is ours and names who acted, stays; the line under it goes.
    content: {
      written: "people",
      companyId: change.companyId,
      withheld: (locale) => ({ body: TASK_NOTIFY_COPY[locale].withheldBody }),
    },
    web: payload,
    native: (locale) => ({ kind: "task_update", ...payload(locale) }),
    // Per task and kind: a later comment replaces the earlier one on the lock
    // screen, and does not erase "Dana finished it".
    collapseKey: `task-update:${change.taskId}:${change.kind}`,
    failures,
  });
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `task ${change.kind} alert: ${failures.length} delivery step(s) failed for ${change.taskId}`,
    );
  }
}

/** Run a notification without letting it touch the response that caused it. */
export function notifyTaskChangeSafely(
  env: Env,
  change: TaskChange,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  return notifyTaskChange(env, change, db).catch((cause: unknown) => {
    console.error(`task ${change.kind} alert failed:`, cause);
  });
}

/**
 * A message that carries a task was ticked or unticked: the message owns done
 * (D17), so the done route knows a message and this finds its task.
 */
export async function notifyPromotedMessageDone(
  env: Env,
  input: { companyId: string; messageId: string; actorUserId: string; done: boolean },
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const tasks = unwrapRows<{ id: string }>(
    await db
      .from("tasks")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("message_id", input.messageId)
      .is("deleted_at", null)
      .limit(1),
    "promoted task lookup",
  );
  if (!tasks[0]) return;
  await notifyTaskChange(
    env,
    {
      companyId: input.companyId,
      taskId: tasks[0].id,
      actorUserId: input.actorUserId,
      kind: input.done ? "completed" : "reopened",
    },
    db,
  );
}
