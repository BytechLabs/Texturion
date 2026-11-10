/**
 * Overdue task alert (#689 D, D152).
 *
 * `due-notice.ts` tells the assignee a job is about to come due. This tells them
 * it did, once, a grace period after the due time: long enough that a job
 * finished a few minutes late never buzzes, short enough that someone can still
 * ring the customer.
 *
 * WHO: the assignee only, while an active member who can still see the task's
 * number (#106, as `notifyAssigned` does), and only if the task is still open.
 *
 * ONCE: `tasks.overdue_notified_at` is claimed before sending. Moving the due
 * time or the assignee clears it (trigger `tasks_rearm_due_notice`), so a
 * rescheduled job can go overdue again.
 *
 * A job more than TASK_OVERDUE_MAX_LATE_MINUTES late is not scanned at all: news
 * that old is stale, and the scan would otherwise fire for the whole history
 * of overdue work the first time it ran.
 */
import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "../notifications/deliver";
import { dueNoticeBody, dueNoticeLink } from "./due-notice";
import { TASK_DUE_COPY } from "./due-notice-copy";
import { TASK_NOTIFY_COPY } from "./notify-copy";

/** Tasks alerted per run, bounding a backlog into paced batches. */
export const TASK_OVERDUE_BATCH = 100;

/** How long after the due time before the job counts as overdue (D152). */
export const TASK_OVERDUE_GRACE_MINUTES = 15;

/** Beyond this the alert is stale and is not sent. */
export const TASK_OVERDUE_MAX_LATE_MINUTES = 120;

const TITLE_LENGTH = 80;

interface OverdueTaskRow {
  id: string;
  company_id: string;
  conversation_id: string | null;
  title: string | null;
  due_at: string;
  assigned_user_id: string;
}

export async function notifyOverdueTasksJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db: SupabaseClient = getDb(env);
  const graceEdge = new Date(now.getTime() - TASK_OVERDUE_GRACE_MINUTES * 60_000);
  const staleEdge = new Date(now.getTime() - TASK_OVERDUE_MAX_LATE_MINUTES * 60_000);

  const { data, error } = await db
    .from("tasks")
    .select("id,company_id,conversation_id,title,due_at,assigned_user_id")
    .lte("due_at", graceEdge.toISOString())
    .gte("due_at", staleEdge.toISOString())
    .is("overdue_notified_at", null)
    .is("deleted_at", null)
    .not("assigned_user_id", "is", null)
    .is("task_done_at", null)
    .order("due_at", { ascending: true })
    .limit(TASK_OVERDUE_BATCH);
  if (error) throw new Error(`overdue task scan failed: ${error.message}`);

  const tasks = (data ?? []) as unknown as OverdueTaskRow[];
  const failures: unknown[] = [];

  for (const task of tasks) {
    // Claim first, send only if the claim was won: two overlapping runs must
    // not both alert, and a crash after sending must not alert every quarter hour.
    const { data: claimed, error: stampError } = await db
      .from("tasks")
      .update({ overdue_notified_at: new Date().toISOString() })
      .eq("id", task.id)
      .is("overdue_notified_at", null)
      .select("id");
    if (stampError) {
      failures.push(
        new Error(`overdue stamp failed for task ${task.id}: ${stampError.message}`),
      );
      continue;
    }
    if ((claimed ?? []).length === 0) continue;

    try {
      if (!(await assigneeMayHear(db, task))) continue;

      const prefs = await db
        .from("notification_prefs")
        .select("user_id,push_enabled")
        .eq("company_id", task.company_id)
        .eq("user_id", task.assigned_user_id);
      if (prefs.error) {
        throw new Error(`notification prefs lookup failed: ${prefs.error.message}`);
      }
      const row = ((prefs.data ?? []) as { push_enabled: boolean }[])[0];
      if (row?.push_enabled === false) continue;

      const authored = (task.title ?? "").trim().slice(0, TITLE_LENGTH);
      const link = dueNoticeLink(env.APP_ORIGIN, task);
      const alert = (locale: Locale) => ({
        title: authored || TASK_DUE_COPY[locale].fallbackTitle,
        body: dueNoticeBody(new Date(task.due_at), now, locale),
        url: link,
      });

      await deliverPush(env, db, {
        category: "tasks",
        companyId: task.company_id,
        userIds: [task.assigned_user_id],
        // The title is a member's words and may carry a job address; the
        // lateness in the body is ours and survives.
        content: {
          written: "people",
          companyId: task.company_id,
          withheld: (locale) => ({
            title: TASK_NOTIFY_COPY[locale].overdueWithheldTitle,
          }),
        },
        web: alert,
        native: (locale) => ({ kind: "task_due", ...alert(locale) }),
        // Replaces the due-soon alert for the same task rather than stacking.
        collapseKey: `task:${task.id}`,
        failures,
      });
    } catch (cause) {
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `task overdue alerts: ${failures.length} step(s) failed`,
    );
  }
}

/** Active member, and not denied the number the task's thread is on. */
async function assigneeMayHear(
  db: SupabaseClient,
  task: OverdueTaskRow,
): Promise<boolean> {
  if (task.conversation_id !== null) {
    const conversation = await db
      .from("conversations")
      .select("phone_number_id")
      .eq("company_id", task.company_id)
      .eq("id", task.conversation_id)
      .limit(1);
    if (conversation.error) {
      throw new Error(`conversation lookup failed: ${conversation.error.message}`);
    }
    const row = ((conversation.data ?? []) as { phone_number_id: string | null }[])[0];
    if (!row) return false;
    const viewers = await listConversationViewers(db, {
      companyId: task.company_id,
      phoneNumberId: row.phone_number_id,
    });
    return viewers.some((viewer) => viewer.user_id === task.assigned_user_id);
  }

  const members = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", task.company_id)
    .eq("user_id", task.assigned_user_id)
    .is("deactivated_at", null)
    .limit(1);
  if (members.error) {
    throw new Error(`membership lookup failed: ${members.error.message}`);
  }
  return (members.data ?? []).length > 0;
}
