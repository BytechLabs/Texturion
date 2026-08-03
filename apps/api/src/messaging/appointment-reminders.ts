/**
 * #237 — turning a job's due date into queued reminders.
 *
 * This module owns exactly one decision: WHEN each reminder should go, and what
 * it should say. Everything after that — firing once, running the pre-send
 * gates, holding and disclosing, expiring rather than arriving late — belongs
 * to #233's scheduled-message queue, because a reminder IS one of those rows.
 * See the migration header for why that is not a shortcut.
 *
 * THE ONE RULE THAT MUST NOT MOVE: the offset is subtracted from the
 * appointment instant, which is absolute, and the RESULT is then described in
 * the CUSTOMER's clock. It is tempting to think of "the day before at 9am" and
 * do calendar arithmetic in a timezone — that is how a reminder for a Monday
 * job lands on Saturday night across a DST boundary. `due_at` is a timestamptz;
 * an offset in minutes off an instant is exact, and `resolveDestinationClock`
 * is asked which clock to DESCRIBE it in, never to compute it.
 */
import {
  REMINDER_OFFSET_MAX_MINUTES,
  REMINDER_OFFSET_MIN_MINUTES,
} from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../routes/core/http";
import { resolveDestinationClock } from "./destination-clock";
import { applySendMergeFields, resolveSendMergeFields } from "./merge";

/**
 * How long after its instant a reminder is still worth sending.
 *
 * Shorter than a hand-scheduled message's 24 hours, and the reason is what the
 * text SAYS. "We're on track for 2pm today" delivered tomorrow morning is not
 * late, it is wrong — it describes an appointment that has already happened.
 * Two hours rides out an outage without ever crossing the appointment itself
 * for the tightest offset we allow.
 */
const REMINDER_HOLD_HOURS = 2;

export interface ReminderRule {
  offset_minutes: number;
  body: string;
  enabled: boolean;
}

/** One reminder, ready for `api_sync_task_reminders`. */
export interface PlannedReminder {
  offset_minutes: number;
  body: string;
  send_at: string;
}

/**
 * Which reminders a job should have, from its due date and the workspace rules.
 *
 * Pure, so the interesting cases are testable without a database: a job in the
 * past, a job so close that the 2-hour reminder has already passed, a rule
 * switched off, an offset outside the allowed window.
 *
 * `now` is a parameter rather than `new Date()` for the same reason — and
 * because "is this reminder still in the future" is the whole of the logic.
 */
export function planReminders(input: {
  dueAt: Date | null;
  rules: readonly ReminderRule[];
  now: Date;
  /** Renders one rule's template. Injected so this stays pure. */
  render: (body: string) => string;
}): PlannedReminder[] {
  const { dueAt, rules, now, render } = input;
  if (dueAt === null || Number.isNaN(dueAt.getTime())) return [];

  return rules
    .filter((rule) => rule.enabled)
    .filter(
      (rule) =>
        rule.offset_minutes >= REMINDER_OFFSET_MIN_MINUTES &&
        rule.offset_minutes <= REMINDER_OFFSET_MAX_MINUTES,
    )
    .map((rule) => ({
      rule,
      at: new Date(dueAt.getTime() - rule.offset_minutes * 60_000),
    }))
    // A reminder whose moment has passed is simply not queued. NOT sent late
    // and not sent immediately: a job booked for two hours from now should get
    // the day-before reminder never, and firing it on creation would text
    // somebody "reminder that we're booked tomorrow" about today.
    .filter((planned) => planned.at.getTime() > now.getTime())
    .map((planned) => ({
      offset_minutes: planned.rule.offset_minutes,
      body: render(planned.rule.body),
      send_at: planned.at.toISOString(),
    }));
}

/**
 * Regenerate one job's reminders against the current rules.
 *
 * Called after every write that can change whether a job deserves reminders:
 * its due date, its completion, its deletion, its suppression flag. Cheap
 * enough to call unconditionally, which is the point — a caller that has to
 * decide whether a change is "reminder-relevant" is a caller that will one day
 * decide wrong, and the failure is silent.
 *
 * Best-effort by contract. A task write must never fail because a reminder
 * could not be queued: the job is the thing the crew is doing, and a missing
 * reminder is recoverable by touching the task again. The caller logs.
 */
export async function syncTaskReminders(
  db: SupabaseClient,
  input: {
    companyId: string;
    taskId: string;
    userId: string;
    now?: Date;
  },
): Promise<{ outcome: string; added?: number; removed?: number }> {
  const now = input.now ?? new Date();

  const task = unwrap<{
    due_at: string | null;
    conversation_id: string;
    reminders_off: boolean;
    conversations: {
      contacts: { phone_e164: string; timezone: string | null } | null;
    } | null;
  } | null>(
    await db
      .from("tasks")
      .select(
        "due_at,conversation_id,reminders_off," +
          "conversations(contacts(phone_e164,timezone))",
      )
      .eq("id", input.taskId)
      .eq("company_id", input.companyId)
      .maybeSingle(),
    "reminder task lookup",
  );
  if (!task) return { outcome: "not_found" };

  const rules = unwrap<ReminderRule[]>(
    await db
      .from("appointment_reminder_rules")
      .select("offset_minutes,body,enabled")
      .eq("company_id", input.companyId)
      .order("offset_minutes", { ascending: false }),
    "reminder rules",
  );

  const destination = task.conversations?.contacts?.phone_e164;
  const dueAt = task.due_at === null ? null : new Date(task.due_at);

  // The clock is resolved against the APPOINTMENT, not against now: a job three
  // weeks out may sit the other side of a DST change, and the provenance we
  // store has to be the one the reminder will be read in.
  const clock = destination
    ? await resolveDestinationClock(db, {
        companyId: input.companyId,
        phoneE164: destination,
        atUtc: dueAt ?? now,
        contactTimezone: task.conversations?.contacts?.timezone ?? null,
      })
    : null;

  // Rendered here rather than at fire time, so the thread strip and the
  // workspace list show the words that will actually go. `{job_day}` and
  // `{job_time}` resolve against this conversation's next open due-dated task,
  // which for a job with a due date is this one.
  let planned: PlannedReminder[] = [];
  if (dueAt !== null && !task.reminders_off && clock) {
    const rendered = new Map<string, string>();
    for (const rule of rules) {
      if (rendered.has(rule.body)) continue;
      const ctx = await resolveSendMergeFields(db, rule.body, {
        companyId: input.companyId,
        conversationId: task.conversation_id,
        userId: input.userId,
        timeZone: clock.timezone,
      });
      rendered.set(rule.body, applySendMergeFields(rule.body, ctx));
    }
    planned = planReminders({
      dueAt,
      rules,
      now,
      render: (body) => rendered.get(body) ?? body,
    });
  }

  const result = unwrap<{ outcome: string; added?: number; removed?: number }>(
    await db.rpc("api_sync_task_reminders", {
      p_company_id: input.companyId,
      p_task_id: input.taskId,
      p_user_id: input.userId,
      p_reminders: planned,
      // A job with no destination still needs its reminders CLEARED, and the
      // RPC's columns are NOT NULL — so the fallback is the workspace's own
      // clock on a call that is only ever passing an empty array.
      p_clock_timezone: clock?.timezone ?? "UTC",
      p_clock_source: clock?.source ?? "company",
      p_expires_at: new Date(
        (dueAt ?? now).getTime() + REMINDER_HOLD_HOURS * 3_600_000,
      ).toISOString(),
    }),
    "sync task reminders",
  );
  return result;
}
