/**
 * #340 — the marketing contact form kept non-customers' data forever.
 *
 * `contact_messages` holds a name, email, company, free-text message and IP
 * for people who are not customers, have no account, and appear in no deletion
 * path we own. It was found by listing all 45 tables and noticing one nobody
 * had thought about.
 *
 * TWO WINDOWS, because the IP is a different kind of thing from the message.
 * The IP exists for abuse forensics — telling a spam flood from a real
 * enquiry — and that question is answered within days. Keeping it for months
 * is keeping a precise identifier for a purpose that has expired. The message
 * itself is a business enquiry somebody chose to send, and a reply might
 * reasonably come weeks later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/** Abuse forensics is a days question, not a months one. */
const IP_RETENTION_DAYS = 30;

/** Matches the audit-log window, so there is one number to remember. */
const MESSAGE_RETENTION_DAYS = 365;

export async function runContactRetentionJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ ipsCleared: number; messagesDeleted: number }> {
  const ips = await db.rpc("api_prune_contact_ips", { p_days: IP_RETENTION_DAYS });
  if (ips.error) throw new Error(`contact IP prune failed: ${ips.error.message}`);

  const messages = await db.rpc("api_prune_contact_messages", {
    p_days: MESSAGE_RETENTION_DAYS,
  });
  if (messages.error) {
    throw new Error(`contact message prune failed: ${messages.error.message}`);
  }

  const ipsCleared = (ips.data as number) ?? 0;
  const messagesDeleted = (messages.data as number) ?? 0;
  if (ipsCleared > 0 || messagesDeleted > 0) {
    // Logged, not emailed. This is the system keeping a promise, not an event
    // needing a human — but the counts belong in the record if anybody ever
    // asks how long we hold this.
    console.log(
      `contact retention: cleared ${ipsCleared} IP(s), deleted ${messagesDeleted} message(s)`,
    );
  }
  return { ipsCleared, messagesDeleted };
}
