/**
 * Missed-call crew alert (FEATURE-GAPS voice wave, Step 1). Fired after a
 * computed-missed call has been auto-texted, so the whole crew learns a call
 * came in, went unanswered, and the customer got the booking-forward text.
 *
 * AUDIENCE + CHANNELS mirror the §8 inbound-message pipeline exactly (assignee
 * else all active members; per notification_prefs; one Resend email to each
 * email-enabled recipient + one Web Push per push-enabled subscription). It is
 * intentionally a SEPARATE call from notifyInboundMessage (no inbound message
 * exists — a phone call is not a text), but shares its delivery primitives.
 *
 * Idempotency: the caller only reaches here when claim_missed_call_text CLAIMED
 * the text (its per-call event guard makes that at-most-once per call), so a
 * retried Call-Control webhook never re-alerts. Failures are collected and
 * thrown so the ledger records them; a sweeper replay is a no-op (the claim is
 * already spent).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { sendEmail } from "../email/resend";
import { sendWebPush } from "./webpush";

export interface MissedCallNotificationInput {
  companyId: string;
  conversationId: string;
  callerE164: string;
  /**
   * Whether the auto text-back actually reached Telnyx. False = the send
   * failed (the row sits §7-retryable in the thread) — the alert copy must
   * NOT claim "we texted them"; it tells the crew to call back instead.
   */
  textSent: boolean;
}

interface ConversationView {
  id: string;
  assigned_user_id: string | null;
  contacts: { name: string | null; phone_e164: string };
}

interface PrefsRow {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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
      .select("id,assigned_user_id,contacts(name,phone_e164)")
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

  // Audience (§8): assignee if still an active member, else all active members.
  const members = unwrapRows<{ user_id: string }>(
    await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", input.companyId)
      .is("deactivated_at", null),
    "company members lookup",
  ).map((row) => row.user_id);
  const audience =
    conversation.assigned_user_id !== null &&
    members.includes(conversation.assigned_user_id)
      ? [conversation.assigned_user_id]
      : members;
  if (audience.length === 0) return;

  const prefRows = unwrapRows<PrefsRow>(
    await db
      .from("notification_prefs")
      .select("user_id,email_enabled,push_enabled")
      .eq("company_id", input.companyId)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const prefs = new Map(prefRows.map((row) => [row.user_id, row]));
  const emailUsers = audience.filter(
    (userId) => prefs.get(userId)?.email_enabled ?? true,
  );
  const pushUsers = audience.filter(
    (userId) => prefs.get(userId)?.push_enabled ?? true,
  );

  const contactName =
    conversation.contacts.name?.trim() || conversation.contacts.phone_e164;
  // The web thread route is /inbox/[conversationId] (the /conversations/:id
  // shape only exists inside the service worker's legacy-push normalizer).
  const link = `${env.APP_ORIGIN}/inbox/${input.conversationId}`;

  // Truthful copy: only claim "we texted them" when Telnyx accepted the text.
  // A failed text makes the miss MORE urgent — tell the crew to call back.
  const sentLine = input.textSent
    ? "We sent them a text so they can book by reply."
    : "We tried to text them but the message didn't go through — call them back.";

  const failures: unknown[] = [];

  if (emailUsers.length > 0) {
    try {
      const to: string[] = [];
      for (const userId of emailUsers) {
        const { data, error } = await db.auth.admin.getUserById(userId);
        if (error) {
          throw new Error(
            `auth admin lookup failed for member ${userId}: ${error.message}`,
          );
        }
        if (data.user?.email) to.push(data.user.email);
      }
      if (to.length > 0) {
        const text =
          `${contactName} called and no one picked up.\n\n` +
          `${sentLine}\n\n` +
          `Open the conversation: ${link}\n`;
        await sendEmail(env, {
          to,
          subject: `Missed call from ${contactName}`,
          text,
          html:
            `<p><strong>${escapeHtml(contactName)}</strong> called and no one picked up.</p>` +
            `<p>${escapeHtml(sentLine)}</p>` +
            `<p><a href="${link}">Open the conversation</a></p>`,
        });
      }
    } catch (cause) {
      failures.push(cause);
    }
  }

  if (pushUsers.length > 0) {
    const subscriptions = unwrapRows<SubscriptionRow>(
      await db
        .from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth")
        .in("user_id", pushUsers),
      "push subscriptions lookup",
    );
    const payload = JSON.stringify({
      title: `Missed call from ${contactName}`,
      body: input.textSent
        ? "We texted them so they can book by reply."
        : "Their text-back failed — call them back.",
      url: link,
    });
    for (const subscription of subscriptions) {
      try {
        const result = await sendWebPush(env, subscription, payload);
        if (result.gone) {
          const { error } = await db
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);
          if (error) {
            throw new Error(
              `dead push subscription cleanup failed: ${error.message}`,
            );
          }
        } else if (!result.ok) {
          throw new Error(
            `push delivery failed with HTTP ${result.status} for subscription ${subscription.id}`,
          );
        }
      } catch (cause) {
        failures.push(cause);
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `missed-call alert: ${failures.length} delivery step(s) failed for conversation ${input.conversationId}`,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
