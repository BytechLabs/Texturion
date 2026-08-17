/**
 * Missed-call crew alert (FEATURE-GAPS voice wave, Step 1; decoupled from the
 * text-back in #132). Fired for every computed-missed INBOUND call, so the
 * whole crew learns a call came in and went unanswered — whether or not the
 * auto text-back is configured (`textSent` steers the copy).
 *
 * AUDIENCE mirrors the §8 inbound-message pipeline (assignee else all active
 * members; per notification_prefs), but CHANNELS are push-only — Web Push per
 * push-enabled subscription + native FCM per device token. NO email (D45,
 * founder call 2026-07-17): the same miss already reaches the crew via native
 * push, web push, the bell feed, and For You, and the caller gets the auto
 * text-back — a per-miss email to every member was pure noise. It is
 * intentionally a SEPARATE call from notifyInboundMessage (no inbound message
 * exists — a phone call is not a text), but shares its delivery primitives.
 *
 * Idempotency is the CALLER's claim, one of two (#132): the text-dispatched
 * path holds claim_missed_call_text (at-most-once per call); every other path
 * fires from the webhook gated on api_thread_call's `event_inserted` (true
 * exactly once per call session). Either way a retried Call-Control webhook
 * never re-alerts. Failures are collected and thrown; both callers catch and
 * log — best-effort alerts are never retried.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "./deliver";
import { routeAfterHoursAlert } from "./on-call";

export interface MissedCallNotificationInput {
  companyId: string;
  conversationId: string;
  callerE164: string;
  /**
   * What happened to the auto text-back, because the copy must stay truthful:
   * 'sent' = Telnyx accepted it; 'failed' = we tried and the send failed (the
   * row sits §7-retryable in the thread); 'none' = no text was ever attempted
   * (#132: MCTB off/unauthored, caller opted out, or throttled). Anything but
   * 'sent' tells the crew to call back instead.
   */
  textStatus: "sent" | "failed" | "none";
}

interface ConversationView {
  id: string;
  assigned_user_id: string | null;
  phone_number_id: string | null;
  contacts: { name: string | null; phone_e164: string };
}

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export async function notifyMissedCall(
  env: Env,
  input: MissedCallNotificationInput,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const conversations = unwrapRows<ConversationView>(
    await db
      .from("conversations")
      .select("id,assigned_user_id,phone_number_id,contacts(name,phone_e164)")
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const conversation = conversations[0];
  if (!conversation) {
    throw new Error(
      `missed-call alert: conversation ${input.conversationId} vanished`,
    );
  }

  // Audience (§8): the assignee, else everyone who can see the thread.
  //
  // #106/#133 is applied FIRST: the caller's name and the deep link would leak
  // a hidden conversation, and the D24 bell arm filtering the SAME event would
  // otherwise tell a different story. An assignee who cannot be told falls back
  // to the team rather than alerting nobody about a missed call.
  const viewers = await listConversationViewers(db, {
    companyId: input.companyId,
    phoneNumberId: conversation.phone_number_id,
  });
  const members = viewers.map((row) => row.user_id);
  const assigned =
    conversation.assigned_user_id !== null &&
    members.includes(conversation.assigned_user_id)
      ? [conversation.assigned_user_id]
      : members;
  if (assigned.length === 0) return;

  // #244: after hours, this goes to whoever is holding the phone rather than
  // to everyone who can see the number. AFTER the assignee rule, not instead of
  // it — a job with a name on it stays that person's at any hour, and taking it
  // off them at 11pm to give to the on-call member is a handover nobody asked
  // for. The narrowing only bites when the audience was still the whole crew.
  //
  // Never throws: every uncertainty inside returns the audience unchanged, so
  // a broken lookup makes this alert loud rather than absent.
  const routing = await routeAfterHoursAlert(db, {
    companyId: input.companyId,
    conversationId: input.conversationId,
    phoneNumberId: conversation.phone_number_id,
    kind: "missed_call",
    audience: assigned,
  });
  const audience = routing.userIds;

  const prefRows = unwrapRows<PrefsRow>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", input.companyId)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const prefs = new Map(prefRows.map((row) => [row.user_id, row]));
  // Founder call 2026-07-17 (D45): NO email for missed calls — the same event
  // already reaches the crew four ways (native push, web push, the bell feed,
  // For You) and the caller gets the auto text-back; an email to every
  // email-enabled member per miss was pure noise. Inbound-message emails are
  // unchanged (§8).
  const pushUsers = audience.filter(
    (userId) => prefs.get(userId)?.push_enabled ?? true,
  );

  const contactName =
    conversation.contacts.name?.trim() || conversation.contacts.phone_e164;
  // The web thread route is /inbox/[conversationId] (the /conversations/:id
  // shape only exists inside the service worker's legacy-push normalizer).
  const link = `${env.APP_ORIGIN}/inbox/${input.conversationId}`;

  const failures: unknown[] = [];

  // WEB PUSH + NATIVE DEVICE PUSH. The native body carries the
  // `kind:'missed_call'` discriminator so the Android client routes it to the
  // dedicated missed-calls channel (PushKind.MISSED_CALL); Web Push stays
  // kind-less, since the service worker renders unmarked pushes as ordinary
  // notices and must not change shape. #162 iOS coalescing keys on the
  // conversation, like the inbound-message alert.
  const body =
    input.textStatus === "sent"
      ? "We texted them so they can book by reply."
      : input.textStatus === "failed"
        ? "Their text-back failed. Call them back."
        : "No text-back went out. Call them back.";
  const alert = { title: `Missed call from ${contactName}`, body, url: link };
  // The alert id rides on the NATIVE payload only: it is what turns the
  // notification into something answerable, and the Web Push service worker
  // renders unmarked pushes as ordinary notices and must not change shape.
  const acknowledgeable = routing.alertId
    ? { alert_id: routing.alertId }
    : {};
  await deliverPush(env, db, {
    category: "missed_calls",
    companyId: input.companyId,
    userIds: pushUsers,
    // #430: every word here is ours. The contact's NAME is in the title, and
    // that stays under the setting too — a name on a lock screen is what any
    // phone shows for any caller, and it is what the setting deliberately
    // preserves. There is no message content in a missed call to withhold.
    content: { written: "us" },
    web: () => alert,
    native: () => ({ kind: "missed_call", ...alert, ...acknowledgeable }),
    collapseKey: `conversation:${input.conversationId}`,
    // #244: only when this was NARROWED to the on-call member. They agreed to
    // hold the phone tonight, so their own quiet hours do not apply to the one
    // thing they agreed to. An un-narrowed alert is ordinary traffic and stays
    // subject to everybody's window — which is the whole point of having one.
    ...(routing.reason === "narrowed"
      ? { overridesQuietHours: { reason: "on_call_page" as const } }
      : {}),
    failures,
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `missed-call alert: ${failures.length} delivery step(s) failed for conversation ${input.conversationId}`,
    );
  }
}

