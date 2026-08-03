/**
 * #233 — the job that turns a scheduled intent into a text.
 *
 * Runs every minute alongside the lead-chase ladder, on the same argument: the
 * scan is a partial index over due rows only, so a quiet minute costs one
 * indexed lookup returning nothing, and a coarser cadence would make "8:00am"
 * mean "some time between 8:00 and 8:05".
 *
 * ---------------------------------------------------------------------------
 * THE GATES RUN NOW, NOT WHEN IT WAS SCHEDULED
 *
 * This is the whole reason the feature is not a client-side timer. Between
 * somebody writing a text on Friday night and it going out on Monday morning,
 * the customer can send STOP, the workspace's card can fail, carrier
 * registration can lapse, and the number can be released. So the firing path
 * calls `runPreSendGates` exactly like an immediate send, and hands the
 * resulting clearance to `dispatchOutbound`.
 *
 * That is not a convention this file could forget: #331 made the clearance a
 * value only `runPreSendGates` can mint, and `dispatchOutbound` demands one, so
 * a send path that skipped the gates would not compile. The opt-out guarantee
 * in #233's acceptance criteria is satisfied by construction.
 *
 * ---------------------------------------------------------------------------
 * HELD IS NOT FAILED, AND BOTH ARE DISCLOSED
 *
 * `docs/DECISIONS.md` fixed this before the feature existed, against #325:
 * held not dropped, everything held or cancelled disclosed to the owner when it
 * happens, and time-sensitive work expiring rather than arriving late.
 *
 * The distinction is load-bearing rather than cosmetic. A HOLD means the
 * condition can clear and the message will go — a paused subscription, a
 * pending registration, an incident. A FAILURE means it never will, and saying
 * "we'll keep trying" would be a lie: an opt-out can only be lifted by the
 * customer, and a number we cannot text will not become textable by waiting.
 * `scheduledReasonRecovers` in @loonext/shared owns that classification so the
 * copy and the retry behaviour cannot disagree.
 *
 * ---------------------------------------------------------------------------
 * TALKING OVER SOMEBODY
 *
 * The one hold that is about manners rather than capability. If the customer
 * replied after this was scheduled, "still thinking about that quote?" arrives
 * after they already said yes, which reads as a robot. The row carries the
 * conversation's newest inbound at scheduling time; a newer one here means the
 * thread moved on, so it holds and asks rather than sending.
 *
 * Deliberately a HOLD and not a cancel: the owner may well still want to send
 * it, and deciding that for them is how a message silently disappears.
 */
import {
  SCHEDULED_HOLD_REASONS,
  type ScheduledHoldReason,
  estimateSegments,
  scheduledReasonRecovers,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { deliverPush } from "../notifications/deliver";
import { dispatchOutbound, runPreSendGates } from "./send";
import type { MessageRow } from "./types";

/**
 * One run's ceiling. Comfortably above any plausible minute — the per-workspace
 * cap is 200 live rows in total, so this only binds if many workspaces happen
 * to schedule the same minute, and the remainder simply goes on the next tick.
 */
const SCAN_LIMIT = 100;

/**
 * How long a claim is good for.
 *
 * Long enough that the gates and a carrier round trip finish inside it, short
 * enough that a worker killed mid-flight does not leave a customer's message
 * unsent for an hour. Five minutes matches the interrupted-send sweep that
 * owns the window after this one.
 */
const LEASE_SECONDS = 300;

interface ScheduledRow {
  id: string;
  company_id: string;
  conversation_id: string;
  body: string;
  send_at: string;
  inbound_watermark: string | null;
  /** #237: the job this reminds about, or null for a text a person wrote. */
  task_id: string | null;
  origin: string;
}

interface Destination {
  from: string;
  to: string;
  newestInbound: string | null;
}

export interface ScheduledSendSummary {
  sent: number;
  held: number;
  failed: number;
  expired: number;
}

function unwrap<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data as T;
}

/**
 * Which gate failure this was, in terms the owner can be told about.
 *
 * `runPreSendGates` throws `ApiError` with a code, and the mapping is
 * exhaustive over the five it can raise. An unrecognised code becomes a
 * SERVICE_UNAVAILABLE hold rather than a failure, deliberately: a gate this
 * file has not been taught about is our ignorance, and holding a message we do
 * not understand is recoverable while discarding it is not.
 */
function reasonFor(cause: unknown): ScheduledHoldReason {
  if (!(cause instanceof ApiError)) return "service_unavailable";
  switch (cause.code) {
    case "recipient_opted_out":
      return "recipient_opted_out";
    case "subscription_inactive":
      return "subscription_inactive";
    case "registration_pending":
      return "registration_pending";
    case "validation_failed":
      return "invalid_destination";
    default:
      return "service_unavailable";
  }
}

/** The numbers this send is between, and where the thread actually stands. */
async function resolveDestination(
  db: SupabaseClient,
  row: ScheduledRow,
): Promise<Destination | null> {
  const { data, error } = await db
    .from("conversations")
    // #291: the thread's number, resolved at SEND time. A number
    // stamped when the text was scheduled would go stale if the crew
    // corrected it in between.
    .select("contact_phone_e164,phone_numbers(number_e164,status)")
    .eq("id", row.conversation_id)
    .eq("company_id", row.company_id)
    .maybeSingle();
  if (error) throw new Error(`scheduled destination lookup: ${error.message}`);

  const conversation = data as unknown as {
    contact_phone_e164: string | null;
    phone_numbers: { number_e164: string; status: string } | null;
  } | null;

  const to = conversation?.contact_phone_e164;
  const number = conversation?.phone_numbers;
  // A released number cannot be sent from, and the gates would not catch it —
  // they check the workspace, not which of its numbers this thread is on.
  if (!to || !number || number.status === "released") return null;

  const { data: newest, error: newestError } = await db
    .from("messages")
    .select("created_at")
    .eq("company_id", row.company_id)
    .eq("conversation_id", row.conversation_id)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newestError) {
    throw new Error(`scheduled inbound watermark: ${newestError.message}`);
  }

  return {
    from: number.number_e164,
    to,
    newestInbound: (newest as { created_at: string } | null)?.created_at ?? null,
  };
}

/** Did the customer answer after this was written? */
function customerReplied(row: ScheduledRow, destination: Destination): boolean {
  if (!destination.newestInbound) return false;
  // No watermark means the thread had no inbound when this was scheduled, so
  // any inbound now is newer by definition.
  if (!row.inbound_watermark) return true;
  return (
    new Date(destination.newestInbound).getTime() >
    new Date(row.inbound_watermark).getTime()
  );
}

/**
 * #237 — is the job this reminder is about still on the books?
 *
 * THE GUARANTEE, AS OPPOSED TO THE OPTIMISATION. Regenerating a job's reminders
 * already removes them when it changes, and that is what keeps the thread strip
 * and the workspace list accurate. But it depends on every write path calling
 * the sync, and "did this edit change whether the job deserves reminders" is
 * exactly the judgement a caller will one day get wrong — silently, and only
 * visibly when a customer is told to expect somebody who is not coming.
 *
 * So the promise lives HERE, at fire time, where #233 already put every other
 * one. A reminder for a job that is done, deleted, or has reminders switched
 * off does not send, whatever the queue says.
 *
 * Completion DERIVES from the source message's `done_at` (D17) — `tasks` has no
 * done column, and asking for one 400s at PostgREST.
 *
 * Returns true when the row is not a reminder at all: a text a person wrote is
 * theirs to send, and no job's state has any bearing on it.
 */
async function jobStillBooked(
  db: SupabaseClient,
  row: ScheduledRow,
): Promise<boolean> {
  if (row.origin !== "reminder" || !row.task_id) return true;

  const { data, error } = await db
    .from("tasks")
    .select("deleted_at,reminders_off,due_at,messages!message_id(done_at)")
    .eq("id", row.task_id)
    .eq("company_id", row.company_id)
    .maybeSingle();
  // A read that FAILED is not evidence the job is gone. Sending is the
  // recoverable direction here — the job was booked when this was queued, and
  // a transient PostgREST error must not silently cancel somebody's reminder.
  if (error) return true;
  if (!data) return false;

  const task = data as unknown as {
    deleted_at: string | null;
    reminders_off: boolean;
    due_at: string | null;
    // PostgREST types a to-one embed as an ARRAY even where it can only ever
    // hold one row, and returns it as an object. Both shapes are read here
    // rather than picked, because guessing wrong reads as "never done" — and
    // "never done" is the direction that keeps sending.
    messages: { done_at: string | null } | { done_at: string | null }[] | null;
  };
  const source = Array.isArray(task.messages) ? task.messages[0] : task.messages;
  return (
    task.deleted_at === null &&
    !task.reminders_off &&
    task.due_at !== null &&
    (source?.done_at ?? null) === null
  );
}

/**
 * Tell the workspace a scheduled message is not going, or not going yet.
 *
 * Push only, matching the lead-chase ladder: this is news about work somebody
 * queued and is waiting on, and an email arriving tomorrow about a text that
 * should have gone this morning has already lost. Everyone who can see the
 * thread hears it — a scheduled send belongs to the workspace, and the person
 * who wrote it may be on a roof.
 */
async function disclose(
  env: Env,
  db: SupabaseClient,
  row: ScheduledRow,
  reason: ScheduledHoldReason,
): Promise<void> {
  // Keyed on the thread's NUMBER, not the thread: #106 access is per number,
  // and telling somebody a text is held on a line they cannot see would leak
  // the existence of the conversation. Looked up here rather than carried on
  // the row, because the expiry sweep discloses without resolving a
  // destination first.
  const { data: conversation, error } = await db
    .from("conversations")
    .select("phone_number_id")
    .eq("id", row.conversation_id)
    .eq("company_id", row.company_id)
    .maybeSingle();
  if (error) throw new Error(`scheduled disclosure audience: ${error.message}`);

  const viewers = await listConversationViewers(db, {
    companyId: row.company_id,
    phoneNumberId: (conversation as { phone_number_id: string | null } | null)
      ?.phone_number_id,
  });
  if (viewers.length === 0) return;

  const title = scheduledReasonRecovers(reason)
    ? "A scheduled text is waiting"
    : "A scheduled text was not sent";

  // Push failures are logged, not thrown. The state change has already
  // happened and the thread and the scheduled list both show the row with its
  // reason, so a dead device degrades the disclosure rather than defeating it —
  // whereas failing the run here would leave the NEXT workspace's message
  // unsent because this one's phone was unreachable.
  const failures: unknown[] = [];

  await deliverPush(env, db, {
    category: "messages_mine",
    companyId: row.company_id,
    failures,
    userIds: viewers.map((viewer) => viewer.user_id),
    // #430: every word of this is ours — the reason copy is written in
    // @loonext/shared and carries nothing the customer said.
    content: { written: "us" },
    // One identity per scheduled message: a second disclosure about the SAME
    // message replaces the first rather than stacking. A held message is
    // retried every minute, and without this that is a notification a minute.
    collapseKey: `scheduled:${row.id}`,
    web: {
      title,
      body: SCHEDULED_HOLD_REASONS[reason],
      url: `${env.APP_ORIGIN}/inbox/${row.conversation_id}`,
    },
  });

  if (failures.length > 0) {
    console.error(
      `scheduled send: ${failures.length} disclosure push(es) failed for ${row.id}`,
    );
  }
}

/** Hold it, and say so. */
async function hold(
  env: Env,
  db: SupabaseClient,
  row: ScheduledRow,
  reason: ScheduledHoldReason,
): Promise<void> {
  unwrap(
    await db.rpc("api_hold_scheduled_message", {
      p_id: row.id,
      p_reason: SCHEDULED_HOLD_REASONS[reason],
    }),
    "hold scheduled message",
  );
  await disclose(env, db, row, reason);
}

/** Fail it permanently, and say why. */
async function fail(
  env: Env,
  db: SupabaseClient,
  row: ScheduledRow,
  reason: ScheduledHoldReason,
): Promise<void> {
  unwrap(
    await db.rpc("api_fail_scheduled_message", {
      p_id: row.id,
      p_reason: SCHEDULED_HOLD_REASONS[reason],
    }),
    "fail scheduled message",
  );
  await disclose(env, db, row, reason);
}

/**
 * Everything past its horizon, expired and disclosed.
 *
 * Runs BEFORE the claim, so a message whose window closed while it was held
 * expires this tick instead of being attempted once more and expiring next
 * time — which would send it late, exactly what rule 3 forbids.
 */
async function expireStale(
  env: Env,
  db: SupabaseClient,
  now: Date,
): Promise<number> {
  const expired = unwrap<ScheduledRow[]>(
    await db.rpc("api_expire_scheduled_messages", {
      p_now: now.toISOString(),
      p_limit: SCAN_LIMIT,
    }),
    "expire scheduled messages",
  );

  for (const row of expired) {
    await disclose(env, db, row, "expired");
  }
  return expired.length;
}

export async function runScheduledSendJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<ScheduledSendSummary> {
  const summary: ScheduledSendSummary = {
    sent: 0,
    held: 0,
    failed: 0,
    expired: 0,
  };

  summary.expired = await expireStale(env, db, now);

  const due = unwrap<ScheduledRow[]>(
    await db.rpc("api_claim_due_scheduled_messages", {
      p_now: now.toISOString(),
      p_limit: SCAN_LIMIT,
      p_lease_seconds: LEASE_SECONDS,
    }),
    "claim due scheduled messages",
  );

  // Collected rather than thrown one at a time, so one workspace's broken
  // send does not stop every other workspace's from going out this minute
  // (#387). Thrown at the end so a broken run is still visible in Sentry.
  const failures: string[] = [];

  for (const row of due) {
    try {
      const destination = await resolveDestination(db, row);
      if (!destination) {
        await fail(env, db, row, "invalid_destination");
        summary.failed += 1;
        continue;
      }

      if (customerReplied(row, destination)) {
        await hold(env, db, row, "customer_replied");
        summary.held += 1;
        continue;
      }

      // #237: before the gates, because this is not a gate — it is the message
      // no longer being wanted. Running the plan/quota checks on a reminder for
      // a job that finished yesterday would be asking permission to send
      // something nobody should send.
      //
      // FAILED rather than held: a finished job does not un-finish, so there is
      // nothing to resume. `scheduledReasonRecovers` says the same, and the two
      // must agree or the row retries forever against a condition that will
      // never change.
      if (!(await jobStillBooked(db, row))) {
        await fail(env, db, row, "job_no_longer_scheduled");
        summary.failed += 1;
        continue;
      }

      let clearance;
      try {
        clearance = await runPreSendGates(env, row.company_id, destination.to);
      } catch (cause) {
        const reason = reasonFor(cause);
        if (scheduledReasonRecovers(reason)) {
          await hold(env, db, row, reason);
          summary.held += 1;
        } else {
          await fail(env, db, row, reason);
          summary.failed += 1;
        }
        continue;
      }

      // The intent becomes a real queued message and closes, in one statement.
      // A cancel that landed while the gates were running wins here: the row is
      // no longer claimable and this returns 'gone' without writing a message.
      const fired = unwrap<{ outcome: string; message?: MessageRow }>(
        await db.rpc("api_fire_scheduled_message", {
          p_id: row.id,
          p_segments_estimate: Math.max(1, estimateSegments(row.body).segments),
        }),
        "fire scheduled message",
      );
      if (fired.outcome !== "fired" || !fired.message) continue;

      // From here the message row exists as 'queued'. If this throws,
      // job:retry-interrupted-sends owns it — that is why the insert is
      // deliberately not rolled back on a dispatch failure.
      await dispatchOutbound(env, db, fired.message, {
        from: destination.from,
        to: destination.to,
        text: row.body,
        mediaUrls: [],
        clearance,
      });
      summary.sent += 1;
    } catch (cause) {
      failures.push(
        `${row.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `scheduled send: ${failures.length} of ${due.length} failed — ${failures.join("; ")}`,
    );
  }
  return summary;
}
