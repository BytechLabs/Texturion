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
  APPOINTMENT_CONFIRMED_EVENT,
  REMINDER_OFFSET_MAX_MINUTES,
  REMINDER_OFFSET_MIN_MINUTES,
  isAppointmentConfirmation,
} from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../routes/core/http";
import {
  lastSendableInstantBefore,
  resolveDestinationClock,
} from "./destination-clock";
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
      // #291: the number the thread is with. The timezone stays the
      // contact's — a second number is not a second country.
      contact_phone_e164: string | null;
      contacts: { timezone: string | null } | null;
    } | null;
  } | null>(
    await db
      .from("tasks")
      .select(
        "due_at,conversation_id,reminders_off," +
          // #291: the number the THREAD is with, not the contact's
          // primary. The timezone still comes from the contact — a
          // second number does not put somebody in a second country.
          "conversations(contact_phone_e164,contacts(timezone))",
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

  const destination = task.conversations?.contact_phone_e164;
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

    // #237's fourth acceptance criterion: "No reminder ever fires after a STOP
    // or OUTSIDE THE LEGAL SEND WINDOW."
    //
    // The STOP half is free — the firing job runs `runPreSendGates` at fire
    // time. The quiet-hours half is not, and this is where it would have been
    // missed: #233 asks the question at SCHEDULE time, in the route, because a
    // person is there to answer it. Nobody is there when a reminder is
    // computed, and an offset lands wherever the arithmetic puts it: two hours
    // before a 7am job is 5am.
    //
    // Moved BACKWARD, never forward. `nextSendableInstant` defers to 8am, which
    // is right for a message with no deadline and wrong for this one — 8am is
    // after the 7am van. Earlier is always still before the job.
    planned = planned
      .map((reminder) => {
        const at = new Date(reminder.send_at);
        const legal = lastSendableInstantBefore(
          clock.timezone,
          clock.region ?? null,
          at,
        );
        return legal === null
          ? null
          : { ...reminder, send_at: legal.toISOString() };
      })
      .filter((reminder): reminder is PlannedReminder => reminder !== null)
      // Shifting back can land in the past — a job booked this morning for
      // 7am tomorrow has no legal slot left for its 2-hour reminder. The
      // future filter runs again rather than being trusted from before the
      // shift, because the shift is what can invalidate it.
      .filter((reminder) => new Date(reminder.send_at).getTime() > now.getTime());
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

/**
 * #237 — "Reply C to confirm", answered.
 *
 * ONLY CONFIRMS A JOB THE CUSTOMER WAS ACTUALLY ASKED ABOUT. The obvious
 * version marks the conversation's next due-dated task confirmed on any
 * matching reply, and it is wrong in the direction that matters: a customer
 * saying "ok" in an unrelated exchange would silently mark a job confirmed, and
 * a dispatcher would then trust it. So this requires a reminder for that job to
 * have been SENT — the question has to have been asked before an answer can
 * mean anything.
 *
 * The caller runs this only on a message the carrier keyword layer did not
 * claim; see `inbound.ts` for why that ordering is load-bearing rather than
 * tidy.
 *
 * Returns the task id when something was confirmed, so a caller can decide
 * whether to say anything. Nothing is texted back either way: "thanks for
 * confirming" is a second message the customer did not ask for, on a thread
 * they have already dealt with, and it costs a segment every time. The crew
 * needs to know; the customer already does.
 */
export async function confirmAppointmentFromReply(
  db: SupabaseClient,
  input: { companyId: string; conversationId: string; body: string },
): Promise<string | null> {
  if (!isAppointmentConfirmation(input.body)) return null;

  // The jobs this thread has been reminded about, soonest first. Ordered by
  // the reminder's send_at rather than the job's due_at because the question
  // was asked at that moment — if two jobs are queued on one thread, the reply
  // answers the one they were most recently asked about.
  const sent = unwrap<{ task_id: string | null }[]>(
    await db
      .from("scheduled_messages")
      .select("task_id")
      .eq("company_id", input.companyId)
      .eq("conversation_id", input.conversationId)
      .eq("origin", "reminder")
      .eq("status", "sent")
      .not("task_id", "is", null)
      .order("send_at", { ascending: false })
      .limit(1),
    "reminded jobs lookup",
  );
  const taskId = sent[0]?.task_id ?? null;
  if (!taskId) return null;

  const result = unwrap<{ outcome: string }>(
    await db.rpc("api_confirm_task", {
      p_company_id: input.companyId,
      p_task_id: taskId,
      p_by: "customer",
    }),
    "confirm task",
  );
  // 'already' is a customer replying twice, or replying to both reminders.
  // They confirmed once; saying so twice in the timeline would be noise.
  if (result.outcome !== "confirmed") return null;

  const { error } = await db.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    actor_user_id: null, // the customer, who has no user row
    type: APPOINTMENT_CONFIRMED_EVENT,
    payload: { task_id: taskId },
  });
  if (error) throw new Error(`appointment_confirmed event: ${error.message}`);

  return taskId;
}
