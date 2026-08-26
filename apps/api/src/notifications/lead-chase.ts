/**
 * #388 — the escalation ladder that makes FIRST RESPONSE a mechanism.
 *
 * Runs every minute. Reads the clocks `conversations.awaiting_reply_since`
 * started, drops everything outside the company's business hours, claims each
 * rung exactly once, and pushes to whoever should now hear about it.
 *
 * PUSH ONLY, deliberately. Email is the slow channel and this feature exists
 * because of a five-minute window; an escalation that arrives in an inbox has
 * already lost. It also keeps the ladder outside the #343 daily email budget
 * entirely, so chasing a lead can never spend a workspace's Resend allowance
 * on the least useful copy it sends all day.
 *
 * BUSINESS HOURS ARE A HARD GATE. Escalating a 2am text to five phones would
 * be indefensible, and the after-hours auto-reply already answers that case
 * honestly. The hours test is the same shared implementation the away reply
 * and MCTB use — there is one definition of "are we open" in this product and
 * this does not become the second.
 *
 * Failures are collected and thrown, so a broken run is visible in Sentry
 * rather than silently skipping a rung (#387).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isAfterHours,
  isValidBusinessHours,
  LEAD_CHASE_WIDEN_MINUTES,
  leadChaseNotification,
} from "@loonext/shared";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "./deliver";

/** One run's ceiling. Far above any plausible minute's worth of unanswered leads. */
const SCAN_LIMIT = 200;

interface DueRow {
  conversation_id: string;
  company_id: string;
  assigned_user_id: string | null;
  phone_number_id: string | null;
  contact_name: string | null;
  contact_phone: string;
  awaiting_since: string;
  from_level: number;
  to_level: number;
  timezone: string;
  business_hours: unknown;
}

function unwrap<T>(result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data as T;
}

/**
 * Split the due rows into the ones we may actually send now.
 *
 * Exported for the tests: the hours rule is the constraint most likely to be
 * broken by a later change, and it is the one whose failure is a customer's
 * phone going off in the middle of the night.
 */
export function inBusinessHours(row: DueRow, now: Date): boolean {
  // A company that has never set hours has `{}`, which isAfterHours reads as
  // closed every day — and that would silently disable the ladder for every
  // workspace that skipped the setting. Treat "no hours configured" as
  // always-open, which matches how the away reply behaves: it is the absence
  // of an after-hours rule, not an after-hours rule of always.
  const hours = row.business_hours;
  if (!isValidBusinessHours(hours) || Object.keys(hours).length === 0) return true;
  return !isAfterHours(row.timezone, hours, now);
}

export async function runLeadChaseJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ sent: number; skipped: number }> {
  const due = unwrap<DueRow[]>(
    await db.rpc("api_due_lead_chases", {
      p_now: now.toISOString(),
      p_widen_minutes: LEAD_CHASE_WIDEN_MINUTES,
      p_limit: SCAN_LIMIT,
    }),
    "due lead chases",
  );
  if (due.length === 0) return { sent: 0, skipped: 0 };

  const sendable = due.filter((row) => inBusinessHours(row, now));
  const skipped = due.length - sendable.length;
  if (sendable.length === 0) return { sent: 0, skipped };

  const failures: unknown[] = [];
  let sent = 0;

  // ONE rung since #463, but the loop stays: the claim is a conditional update
  // keyed on the level being advanced FROM, so a second rung would again need
  // its own predicate rather than folding into this statement. Keeping the
  // shape costs nothing and is what a second rung would need back.
  for (const fromLevel of [0]) {
    const rows = sendable.filter((row) => row.from_level === fromLevel);
    if (rows.length === 0) continue;

    const claimedIds = unwrap<string[]>(
      await db.rpc("api_claim_lead_chases", {
        p_conversation_ids: rows.map((row) => row.conversation_id),
        p_from_level: fromLevel,
      }),
      "claim lead chases",
    );
    const claimed = new Set(claimedIds);

    for (const row of rows) {
      // Not claimed = another run took this rung, or the clock stopped between
      // the select and the update (somebody replied in those milliseconds,
      // which is the outcome we wanted).
      if (!claimed.has(row.conversation_id)) continue;
      try {
        await sendChase(env, db, row, failures);
        sent += 1;
      } catch (cause) {
        failures.push(cause);
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `lead chase: ${failures.length} escalation(s) failed`,
    );
  }
  return { sent, skipped };
}

async function sendChase(
  env: Env,
  db: SupabaseClient,
  row: DueRow,
  failures: unknown[],
): Promise<void> {
  // #106 first, exactly as the inbound pipeline does it: who is even allowed
  // to be told about this thread is settled before who we choose to tell.
  const viewers = await listConversationViewers(db, {
    companyId: row.company_id,
    phoneNumberId: row.phone_number_id,
  });
  const members = viewers.map((viewer) => viewer.user_id);

  // Everyone who can see the thread. The surviving rung only ever runs on an
  // ASSIGNED conversation (the RPC enforces it) and widening is its entire
  // purpose — an unassigned lead was already announced to the whole crew when
  // it arrived (D52), so there is nobody new to reach.
  const audience = members;
  if (audience.length === 0) return;

  const prefRows = unwrap<{ user_id: string; push_enabled: boolean }[]>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", row.company_id)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const prefs = new Map(prefRows.map((pref) => [pref.user_id, pref]));
  // A member who turned push off does not get it back through a side door.
  // This is the rule that keeps the ladder from being a way around the
  // preference rather than a feature within it.
  const pushUsers = audience.filter((userId) => prefs.get(userId)?.push_enabled ?? true);
  if (pushUsers.length === 0) return;

  const contactName = row.contact_name?.trim() || row.contact_phone;

  await deliverPush(env, db, {
    category: "messages_all",
    companyId: row.company_id,
    userIds: pushUsers,
    // #430: `leadChaseNotification` writes both lines; the customer's name is
    // the only thing of theirs in it, and the setting keeps names.
    content: { written: "us" },
    web: (locale) => {
      const copy = leadChaseNotification(2, contactName, locale);
      return {
        title: copy.title,
        body: copy.body,
        url: `${env.APP_ORIGIN}/inbox/${row.conversation_id}`,
      };
    },
    // Its OWN key, not the thread's, so a later run of this rung coalesces
    // with itself rather than replacing the customer's own message on the lock
    // screen. The rung number stays in the key: it cost nothing when there
    // were two and it is what a second rung would need back.
    collapseKey: `lead-chase:${row.to_level}:${row.conversation_id}`,
    // The one situation this feature exists for is a phone in a pocket, which
    // is a phone in Doze. NORMAL priority is deferred, and a deferred nudge
    // about a five-minute window is not a nudge.
    //
    // #452: this rides the SAME daily ceiling as the first-inbound `lead`
    // push, not one of its own. Both are driven by inbound text volume, so an
    // inbound flood drives both — separate ceilings would let it spend the
    // budget twice over.
    highPriority: { companyId: row.company_id, reason: "lead_chase" },
    failures,
  });
}
