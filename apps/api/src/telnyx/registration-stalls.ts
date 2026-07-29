/**
 * #310 — a registration that has been pending too long, while it is still
 * recoverable.
 *
 * "Pending" for several days with no visible movement is indistinguishable
 * from broken, and people do not abandon because of the wait — they abandon
 * because they cannot tell whether the wait is working. A workspace stuck
 * unusually long is recoverable with one message from a founder today and
 * unrecoverable a week later.
 *
 * Nothing watched for this. The poller (`job:poll-registrations`) advances
 * registrations that MOVE; a registration that simply sits there produces no
 * event, no error and no trace — the same silent-absence shape #387 exists for,
 * applied to a customer's first two weeks instead of a cron.
 *
 * ---------------------------------------------------------------------------
 * WHY THE THRESHOLD IS WHAT IT IS.
 *
 * The honest range we quote is "usually 3-7 business days, sometimes longer".
 * Alerting at day 4 would fire on the ordinary case and teach whoever reads it
 * to ignore the mailbox — the same failure the liveness graces are tuned
 * against. Ten days is past the range we told the customer, which is the point
 * at which OUR estimate was wrong and somebody should say so to them before
 * they work it out themselves.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * Past the range we quoted. See the header: earlier would alert on the normal
 * case, which is how an alert becomes noise.
 */
const STALL_DAYS = 10;

/** One workspace whose registration has outlived our own estimate. */
interface StalledRegistration {
  id: string;
  company_id: string;
  kind: string;
  status: string;
  submitted_at: string;
  companies: { name: string } | null;
}

export async function runRegistrationStallJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<StalledRegistration[]> {
  const cutoff = new Date(now.getTime() - STALL_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await db
    .from("messaging_registrations")
    .select("id,company_id,kind,status,submitted_at,companies(name)")
    // Both waiting states. `submitted` that never became `pending` is the
    // worse one — it can mean our submission never landed at all.
    .in("status", ["submitted", "pending"])
    .lt("submitted_at", cutoff.toISOString())
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`registration stall scan failed: ${error.message}`);

  const stalled = (data ?? []) as unknown as StalledRegistration[];
  if (stalled.length === 0) return stalled;

  const lines = stalled.map((row) => {
    const days = Math.floor(
      (now.getTime() - Date.parse(row.submitted_at)) / (24 * 60 * 60 * 1000),
    );
    return `  ${row.companies?.name ?? row.company_id} — ${row.kind} ${row.status} for ${days} days`;
  });

  const text =
    `${stalled.length} registration(s) have been waiting longer than the ` +
    `${STALL_DAYS} days we tell customers to expect:\n\n${lines.join("\n")}\n\n` +
    `Each of these is a workspace paying for a number that cannot text, with ` +
    `no way to tell whether the wait is working. They are recoverable with one ` +
    `message today and gone in a week — the wait is not what makes people ` +
    `leave, being unable to tell if it is broken is.\n\n` +
    `A 'submitted' row that never reached 'pending' is the more serious case: ` +
    `it can mean the submission never landed at the carrier at all, which the ` +
    `poller would not distinguish from a slow review.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] ${stalled.length} registration(s) stalled past ${STALL_DAYS} days`,
    text,
    html: renderEmailHtml(text),
  });

  return stalled;
}
