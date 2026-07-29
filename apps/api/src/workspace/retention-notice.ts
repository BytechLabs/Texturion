/**
 * #284 — tell somebody before anything is destroyed.
 *
 * The issue's last scope line is the one that decides this feature's
 * reputation: *"users must never discover retention by losing something."*
 *
 * So the warning ships before the deletion, and reads the SAME function the
 * enforcement job will read. If the notice and the deletion computed the
 * at-risk set separately they would drift, and the drift would be somebody
 * warned about one thing and losing another.
 *
 * ---------------------------------------------------------------------------
 * IT GOES TO THE CUSTOMER, NOT TO OPS.
 *
 * Almost every other alert in this codebase mails the founder, because almost
 * every other alert is about our infrastructure. This one is about the
 * customer's data, on a schedule the customer chose or accepted, and it is
 * useless in an ops mailbox — the only person who can act on it is the one who
 * might want to export first.
 *
 * ONE NOTICE PER WINDOW. Claimed through an insert so a redelivery or a second
 * run cannot mail the same workspace twice; and a workspace that SHORTENS its
 * retention is warned again, because the data now at risk is different data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { billingRecipients } from "../billing/recipients";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** How long before the axe somebody is told. */
const WARN_DAYS = 30;

interface DueRow {
  company_id: string;
  company_name: string | null;
  window_days: number;
  message_count: number;
  oldest_at: string;
}

export async function runRetentionNoticeJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_retention_due", { p_warn_days: WARN_DAYS });
  if (error) throw new Error(`retention due scan failed: ${error.message}`);

  let sent = 0;
  for (const row of (data ?? []) as DueRow[]) {
    // Claim first. If the insert loses, somebody has already been told about
    // this window and a second email would be worse than none — it reads as a
    // system that has lost track of what it is deleting.
    const { data: claimed, error: claimError } = await db.rpc(
      "api_record_retention_notice",
      {
        p_company_id: row.company_id,
        p_window: row.window_days,
        p_count: Math.min(row.message_count, 2_147_483_647),
      },
    );
    if (claimError) {
      console.error(`retention notice claim failed for ${row.company_id}: ${claimError.message}`);
      continue;
    }
    if (claimed !== true) continue;

    try {
      const to = await billingRecipients(env, row.company_id, db);
      if (to.length === 0) continue;

      const years = Math.round((row.window_days / 365) * 10) / 10;
      const text =
        `Some of your oldest messages are approaching the end of the ` +
        `${row.window_days}-day (about ${years} year) window your workspace ` +
        `keeps them for.\n\n` +
        `About ${row.message_count} message(s), the oldest from ` +
        `${new Date(row.oldest_at).toLocaleDateString()}, will start aging out ` +
        `in around ${WARN_DAYS} days.\n\n` +
        `You do not have to do anything. If you want to keep a copy, you can ` +
        `export your data from Settings at any time. If you would rather keep ` +
        `messages for longer, your workspace is already on the longest window ` +
        `we offer.\n\n` +
        `We are telling you in advance because nobody should find out about a ` +
        `retention policy by losing something.`;

      await sendEmail(env, {
        to,
        subject: "Some of your oldest messages age out next month",
        text,
        html: renderEmailHtml(text),
      });
      sent += 1;
    } catch (cause) {
      // The claim is already recorded, so this workspace will not be retried.
      // That is the correct trade: a duplicate warning about data destruction
      // is more alarming than a missed one, and the enforcement job is not
      // built yet — nothing is actually at risk today.
      console.error(`retention notice send failed for ${row.company_id}: ${String(cause)}`);
    }
  }

  return sent;
}
