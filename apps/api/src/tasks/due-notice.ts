/**
 * Task due-date reminders (SPEC §11 scheduled job).
 *
 * A due date used to be an in-app fact: For You pins overdue tasks and the list
 * filters on them, but nothing reached a phone. A crew member on a roof found
 * out a job was due by opening the app, which is exactly when they are not
 * holding it. This sends ONE push per task as it comes due.
 *
 * WHO: the assignee, and only the assignee. An unassigned task with a due date
 * is a triage problem rather than a reminder problem, and it already surfaces
 * in the lead's For You triage strip; waking the whole crew for it would train
 * everyone to ignore the channel.
 *
 * ONCE: `tasks.due_notified_at` is stamped after the send. Changing a task's
 * due date clears the stamp (a trigger, so every writer obeys it), which is
 * what makes a rescheduled task remind again on its new date.
 *
 * PUSH ONLY, no email, for the same reason missed-call alerts carry none: the
 * task is already in For You and the list, and an email per due task would be
 * noise on a busy week.
 *
 * Best-effort by construction: the stamp is written whether or not delivery
 * succeeded. A push that could not be sent is not worth re-sending at the next
 * quarter hour, because by then the reminder is stale and the task is visible
 * everywhere else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "../notifications/deliver";

/**
 * Tasks reminded per run. At one run every 15 minutes this is far above any
 * real workspace's due rate, and it bounds a backlog (a long outage, or a bulk
 * import of past-due work) into paced batches instead of one enormous fan-out.
 */
export const TASK_DUE_BATCH = 100;

/** Keep the body to a notification-shade line rather than a wall of text. */
const TITLE_LENGTH = 80;

interface DueTaskRow {
  id: string;
  company_id: string;
  conversation_id: string | null;
  title: string | null;
  assigned_user_id: string;
  messages: { done_at: string | null } | null;
}

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

export async function notifyDueTasksJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db: SupabaseClient = getDb(env);

  // Completion lives on the promoted message, not on the task (the task routes
  // have no `done` field), so the join is what tells a finished job from a live
  // one. An inner join also drops any task whose message went away.
  const { data, error } = await db
    .from("tasks")
    .select(
      "id,company_id,conversation_id,title,assigned_user_id,messages!inner(done_at)",
    )
    .lte("due_at", now.toISOString())
    .is("due_notified_at", null)
    .is("deleted_at", null)
    .not("assigned_user_id", "is", null)
    .is("messages.done_at", null)
    .order("due_at", { ascending: true })
    .limit(TASK_DUE_BATCH);
  if (error) throw new Error(`due task scan failed: ${error.message}`);

  const tasks = (data ?? []) as unknown as DueTaskRow[];
  if (tasks.length === 0) return;

  const failures: unknown[] = [];
  for (const task of tasks) {
    // Stamp FIRST. A crash between sending and stamping would otherwise remind
    // the same person every quarter hour until someone finished the task.
    const { error: stampError } = await db
      .from("tasks")
      .update({ due_notified_at: new Date().toISOString() })
      .eq("id", task.id)
      .is("due_notified_at", null);
    if (stampError) {
      failures.push(
        new Error(`due notice stamp failed for task ${task.id}: ${stampError.message}`),
      );
      continue;
    }

    const prefRows = await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", task.company_id)
      .eq("user_id", task.assigned_user_id);
    if (prefRows.error) {
      failures.push(
        new Error(`notification prefs lookup failed: ${prefRows.error.message}`),
      );
      continue;
    }
    const prefs = (prefRows.data ?? []) as PrefsRow[];
    // A missing row reads as the §6 defaults, which have push on.
    if (prefs[0]?.push_enabled === false) continue;

    const title = (task.title ?? "").trim().slice(0, TITLE_LENGTH) || "A task";
    // Task notifications open the conversation the work is about, matching the
    // bell feed. A task with no conversation opens the task list instead.
    const link = task.conversation_id
      ? `${env.APP_ORIGIN}/inbox/${task.conversation_id}`
      : `${env.APP_ORIGIN}/tasks`;
    const alert = { title, body: "Due now", url: link };

    await deliverPush(env, db, {
      userIds: [task.assigned_user_id],
      webPayload: JSON.stringify(alert),
      // Structural discriminator for the native clients. No client routes on
      // it yet, so it renders on the default channel; it is sent ahead of that
      // so a dedicated channel needs no server change (the same order
      // missed_call went in). Web Push stays kind-less: the service worker
      // renders unmarked pushes as ordinary notices and must not change shape.
      nativePayload: JSON.stringify({ kind: "task_due", ...alert }),
      // One task, one alert: a reminder never stacks with itself.
      collapseKey: `task:${task.id}`,
      failures,
    });
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `task due reminders: ${failures.length} step(s) failed`,
    );
  }
}
