/**
 * #387 — the checker half of the liveness primitive.
 *
 * Split from liveness.ts on purpose: the declarations and `recordHeartbeat`
 * have no business importing the email sender, and `email/resend.ts` records
 * its own heartbeat. Keeping the alert path in a separate module is what makes
 * that a straight line rather than an import cycle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { LIVENESS_EXPECTATIONS, recordHeartbeatBestEffort } from "./liveness";

/** How long an alerting key waits before it shouts again. */
const REALERT_AFTER_MINUTES = 360;

/**
 * How far back the outbound-text probe looks.
 *
 * The SMS channel is probed from the messages table rather than recorded on
 * the send path, because a heartbeat write per text would put a database
 * round-trip on the hot path of every inbound webhook to learn something one
 * query an hour answers just as well. Email is the other way round — it is
 * low volume and has no table to read, so `sendEmail` records its own.
 */
const SMS_PROBE_WINDOW_MINUTES = 60;

interface OverdueRow {
  key: string;
  what: string;
  last_seen_at: string;
  due_by: string;
  first_alert: boolean;
}

/**
 * The checker. Compares every declared expectation against the ledger and
 * emails the founder about anything overdue.
 *
 * Runs on the 15-minute trigger rather than its own: a checker with its own
 * schedule is one more thing that can quietly stop, and the schedule it rides
 * on is itself watched by the very table it is reading.
 */
export async function runLivenessCheckJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ overdue: number; seeded: number }> {
  await probeOutboundSms(env, now, db);

  const expectations = Object.entries(LIVENESS_EXPECTATIONS).map(([key, spec]) => ({
    key,
    what: spec.what,
    every_minutes: spec.everyMinutes,
    grace_minutes: spec.graceMinutes,
  }));

  const { data, error } = await db.rpc("api_liveness_check", {
    p_expectations: expectations,
    p_now: now.toISOString(),
    p_realert_after_minutes: REALERT_AFTER_MINUTES,
  });
  if (error) throw new Error(`api_liveness_check failed: ${error.message}`);

  const result = (data ?? {}) as { overdue?: OverdueRow[]; seeded?: string[] };
  const overdue = result.overdue ?? [];
  const seeded = result.seeded ?? [];

  if (overdue.length > 0) {
    await sendOverdueAlert(env, overdue, now);
  }
  return { overdue: overdue.length, seeded: seeded.length };
}

async function sendOverdueAlert(
  env: Env,
  overdue: OverdueRow[],
  now: Date,
): Promise<void> {
  const lines = overdue
    .map((row) => {
      const minutes = Math.round(
        (now.getTime() - new Date(row.last_seen_at).getTime()) / 60000,
      );
      return `• ${row.key}\n  ${row.what}\n  Last seen ${minutes} min ago (due by ${row.due_by}).`;
    })
    .join("\n\n");

  const text =
    `${overdue.length} expected thing(s) have not happened.\n\n${lines}\n\n` +
    `Nothing threw. These are absences, which is why Sentry is quiet: the ` +
    `carrier accepts and drops, the mailbox bounces after we were told 200, ` +
    `the cron simply does not fire. Silence and health look identical from ` +
    `here, which is the whole reason this check exists (#387).\n\n` +
    `You will get one more of these in ${REALERT_AFTER_MINUTES / 60}h if it ` +
    `is still overdue, and nothing at all once it recovers.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] ${overdue.length} expected thing(s) did not happen`,
    text,
    html: emailLayout(
      `<p><strong>${overdue.length} expected thing(s) have not happened.</strong></p>` +
        `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeText(lines)}</pre>`,
    ),
  });
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Did any workspace successfully send a text in the window?
 *
 * Platform-wide and deliberately not per-tenant: one plumber having a quiet
 * afternoon is not a signal, and alerting per workspace would turn a real
 * outage into a hundred emails. What this catches is the case where sending is
 * broken for EVERYBODY and every inbox is silent — the failure that looks
 * exactly like a slow week from the inside.
 *
 * Reads `status`, not merely the row: a message we queued and never handed to
 * the carrier is not evidence that sending works. It is the opposite.
 */
async function probeOutboundSms(
  env: Env,
  now: Date,
  db: SupabaseClient,
): Promise<void> {
  const since = new Date(now.getTime() - SMS_PROBE_WINDOW_MINUTES * 60_000);
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .gte("created_at", since.toISOString())
    .limit(1);
  if (error) {
    // The probe itself failing is not proof the channel is down, so it must
    // not record a heartbeat AND must not claim an outage. Leaving the ledger
    // untouched lets the absence speak for itself one cadence later.
    console.error(`liveness: outbound SMS probe failed: ${error.message}`);
    return;
  }
  if ((data ?? []).length > 0) {
    await recordHeartbeatBestEffort(env, "channel:sms-outbound", now, db);
  }
}
