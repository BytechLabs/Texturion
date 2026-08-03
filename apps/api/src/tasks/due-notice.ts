/**
 * Task due-date reminders (SPEC §11 scheduled job).
 *
 * A due date used to be an in-app fact: For You pins overdue tasks and the list
 * filters on them, but nothing reached a phone. A crew member on a roof found
 * out a job was due by opening the app, which is exactly when they are not
 * holding it. This sends ONE push per task as it comes due.
 *
 * AHEAD of the deadline, not on it. A tradesperson told at 2pm that a 2pm job
 * is due has already missed it: the reminder has to arrive while there is
 * still time to drive, call, or reschedule. The window is deliberately short,
 * because an alert far in advance is one that gets dismissed and forgotten.
 *
 * WHO: the assignee, and only the assignee, and only while they are still an
 * active member of that company. An unassigned task with a due date is a triage
 * problem rather than a reminder problem, and it already surfaces in the lead's
 * For You triage strip; waking the whole crew for it would train everyone to
 * ignore the channel.
 *
 * Removing a member stamps `company_members.deactivated_at`; it does not clear
 * the tasks they were assigned, and push registrations are per USER with no
 * company column, so without the membership check a removed member keeps
 * receiving that workspace's reminders. A task title is seeded from the
 * customer's own message, so those alerts carry customer detail out of a
 * workspace the reader no longer belongs to. Every other push pipeline
 * (notifications/inbound.ts, notifications/missed-call.ts) resolves its
 * audience through active company_members for the same reason.
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

/**
 * How far ahead of the deadline the reminder goes out. Long enough to act on
 * (a phone call, a change of plan, the drive across town), short enough that
 * the task is still the next thing on the person's mind.
 */
export const TASK_DUE_LEAD_MINUTES = 30;

/**
 * How late a deadline can be and still be worth a push.
 *
 * The scan has no lower bound by design: work that came due during an outage
 * still deserves its reminder once the job runs again. But a deadline from last
 * month does not, and without a ceiling the first run after ANY gap (a new
 * column with no history stamped, a restored backup, a bulk import of dated
 * work) fires one alert per historical task. Anything older is claimed and
 * passed over, which also keeps it out of the pending index for good.
 */
export const TASK_DUE_MAX_LATE_MINUTES = 24 * 60;

/**
 * What the alert says under the task title. Relative rather than a clock time,
 * so it needs no timezone and cannot contradict the reader's own phone.
 *
 * A backlog matters here: the first run after an outage, or a bulk import of
 * past-due work, reminds about tasks that are long overdue. Telling someone a
 * job from last Tuesday is "due in 30 minutes" would be a lie, so how late it
 * already is gets said plainly.
 */
export function dueNoticeBody(dueAt: Date, now: Date): string {
  const minutes = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (minutes >= 1) return `Due in ${minutes} min`;
  if (minutes > -1) return "Due now";

  const late = -minutes;
  if (late < 60) return `${late} min overdue`;
  const hours = Math.round(late / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} overdue`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} overdue`;
}

interface DueTaskRow {
  id: string;
  company_id: string;
  conversation_id: string | null;
  title: string | null;
  due_at: string;
  assigned_user_id: string;
  messages: { done_at: string | null } | null;
}

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

/**
 * Where the alert lands: the JOB, not just the thread it came from.
 *
 * The task drawer is mounted in the app shell and driven by `?task=`, so a
 * conversation carrying that param gives both at once, the address and due
 * time and checklist over the customer they belong to. A task with no
 * conversation behind it opens its own page, which renders the same panel from
 * cold, which is the state a notification tap arrives in.
 */
export function dueNoticeLink(
  origin: string,
  task: { id: string; conversation_id: string | null },
): string {
  return task.conversation_id
    ? `${origin}/inbox/${task.conversation_id}?task=${task.id}`
    : `${origin}/tasks/${task.id}`;
}

export async function notifyDueTasksJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db: SupabaseClient = getDb(env);

  // Completion lives on the promoted message, not on the task (the task routes
  // have no `done` field), so the join is what tells a finished job from a live
  // one. An inner join also drops any task whose message went away.
  //
  // The relationship MUST be named, exactly as the /v1/tasks reads do. Two
  // foreign keys connect these tables (`messages.task_id` for a task's own
  // messages, `tasks.message_id` for the message a task was promoted from), so
  // a bare `messages!inner` is ambiguous and PostgREST refuses the whole
  // request with PGRST201. Completion lives on the promoted message.
  const { data, error } = await db
    .from("tasks")
    .select(
      "id,company_id,conversation_id,title,due_at,assigned_user_id," +
        "messages!message_id!inner(done_at)",
    )
    .lte("due_at", new Date(now.getTime() + TASK_DUE_LEAD_MINUTES * 60_000).toISOString())
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
    // Claim FIRST, and only send if the claim was won. A crash between sending
    // and stamping would otherwise remind the same person every quarter hour
    // until someone finished the task, and two runs that overlap (a slow batch
    // still going when the next quarter hour fires) would both send. The guard
    // is the whole point of the claim, so the row count has to be read: an
    // update that changed nothing means another run already owns this one.
    const { data: claimed, error: stampError } = await db
      .from("tasks")
      .update({ due_notified_at: new Date().toISOString() })
      .eq("id", task.id)
      .is("due_notified_at", null)
      .select("id");
    if (stampError) {
      failures.push(
        new Error(`due notice stamp failed for task ${task.id}: ${stampError.message}`),
      );
      continue;
    }
    if ((claimed ?? []).length === 0) continue;

    // Still one of the crew? Deactivation leaves the assignment in place, so
    // this is the only thing standing between a removed member and a workspace
    // they can no longer open.
    const membership = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", task.company_id)
      .eq("user_id", task.assigned_user_id)
      .is("deactivated_at", null)
      .limit(1);
    if (membership.error) {
      failures.push(
        new Error(`membership lookup failed: ${membership.error.message}`),
      );
      continue;
    }
    if ((membership.data ?? []).length === 0) continue;

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

    // Claimed above, so it leaves the queue either way. Whether it is still
    // worth waking someone for is a separate question.
    const lateMinutes = (now.getTime() - new Date(task.due_at).getTime()) / 60_000;
    if (lateMinutes > TASK_DUE_MAX_LATE_MINUTES) continue;

    const title = (task.title ?? "").trim().slice(0, TITLE_LENGTH) || "A task";
    const link = dueNoticeLink(env.APP_ORIGIN, task);
    const alert = {
      title,
      body: dueNoticeBody(new Date(task.due_at), now),
      url: link,
    };

    await deliverPush(env, db, {
      companyId: task.company_id,
      userIds: [task.assigned_user_id],
      // #430: NOT named in the issue, and it belongs here. The TITLE is the
      // one a member typed, and per docs/PERSONAL-DATA-INVENTORY.md a task
      // carries a free-text description and a JOB ADDRESS — "Alvarez, 42 Elm,
      // gate code 4417" is an ordinary task title. So here it is the title
      // that is withheld and the body, which is our own "Due in 2 hours",
      // that survives: the reminder still tells them WHEN without telling the
      // room WHERE.
      content: {
        written: "people",
        companyId: task.company_id,
        withheld: { title: "A task is due" },
      },
      web: alert,
      // Structural discriminator for the native clients. No client routes on
      // it yet, so it renders on the default channel; it is sent ahead of that
      // so a dedicated channel needs no server change (the same order
      // missed_call went in). Web Push stays kind-less: the service worker
      // renders unmarked pushes as ordinary notices and must not change shape.
      native: { kind: "task_due", ...alert },
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
