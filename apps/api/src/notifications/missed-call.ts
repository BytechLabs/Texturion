/**
 * Missed-call crew alert (FEATURE-GAPS voice wave, Step 1; decoupled from the
 * text-back in #132). Fired for every computed-missed INBOUND call, so the
 * whole crew learns a call came in and went unanswered — whether or not the
 * auto text-back is configured (`textSent` steers the copy).
 *
 * AUDIENCE + CHANNELS mirror the §8 inbound-message pipeline exactly (assignee
 * else all active members; per notification_prefs; one Resend email to each
 * email-enabled recipient + one Web Push per push-enabled subscription). It is
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

import { levelFromRules, type NumberAccessRule } from "../auth/number-access";
import type { MemberRole } from "../context";
import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { isFcmConfigured, sendFcm } from "./fcm";
import { sendWebPush } from "./webpush";

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

interface DeviceTokenRow {
  id: string;
  user_id: string;
  platform: "android" | "ios";
  token: string;
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

  // Audience (§8): assignee if still an active member, else all active members.
  const memberRows = unwrapRows<{ user_id: string; role: MemberRole }>(
    await db
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", input.companyId)
      .is("deactivated_at", null),
    "company members lookup",
  );
  const members = memberRows.map((row) => row.user_id);
  let audience =
    conversation.assigned_user_id !== null &&
    members.includes(conversation.assigned_user_id)
      ? [conversation.assigned_user_id]
      : members;
  if (audience.length === 0) return;

  // #106/#133: never alert a member who can't see this number — the caller's
  // name/number and the deep link would leak a hidden conversation, and the
  // D24 bell arm filtering the SAME event would tell a different story.
  // Mirrors notifyInboundMessage: notes-only members can read the thread, so
  // only level 'none' is dropped; owners/admins always keep access.
  if (conversation.phone_number_id) {
    const rules = unwrapRows<NumberAccessRule>(
      await db
        .from("number_access")
        .select("phone_number_id,principal_kind,principal,level")
        .eq("company_id", input.companyId)
        .eq("phone_number_id", conversation.phone_number_id),
      "number access lookup",
    );
    if (rules.length > 0) {
      const roleOf = new Map(memberRows.map((row) => [row.user_id, row.role]));
      audience = audience.filter((userId) => {
        const role = roleOf.get(userId) ?? "member";
        if (role === "owner" || role === "admin") return true;
        return levelFromRules(rules, userId, role) !== "none";
      });
      if (audience.length === 0) return;
    }
  }

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

  // Truthful copy: only claim "we texted them" when Telnyx accepted the text,
  // and only claim we TRIED when we actually did. No text (or a failed one)
  // makes the miss MORE urgent — tell the crew to call back.
  const sentLine =
    input.textStatus === "sent"
      ? "We sent them a text so they can book by reply."
      : input.textStatus === "failed"
        ? "We tried to text them but the message didn't go through. Call them back."
        : "They haven't been texted back — call them back when you can.";

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
        // Recurring notification email: opt-out path (settings footer +
        // List-Unsubscribe header), mirroring the §8 inbound-message email.
        const settingsUrl = `${env.APP_ORIGIN}/settings/notifications`;
        const text =
          `${contactName} called and no one picked up.\n\n` +
          `${sentLine}\n\n` +
          `Open the conversation: ${link}\n\n` +
          `Turn these alerts off: ${settingsUrl}\n`;
        await sendEmail(env, {
          to,
          subject: `Missed call from ${contactName}`,
          text,
          html: emailLayout(
            `<p><strong>${escapeHtml(contactName)}</strong> called and no one picked up.</p>` +
              `<p>${escapeHtml(sentLine)}</p>` +
              `<p><a href="${link}" style="color:#2740de;text-decoration:underline;">Open the conversation</a></p>` +
              `<p style="font-size:14px;color:#7a828c;"><a href="${settingsUrl}" style="color:#7a828c;">Turn these alerts off</a></p>`,
          ),
          headers: { "List-Unsubscribe": `<${settingsUrl}>` },
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
      body:
        input.textStatus === "sent"
          ? "We texted them so they can book by reply."
          : input.textStatus === "failed"
            ? "Their text-back failed. Call them back."
            : "No text-back went out. Call them back.",
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
            `push delivery failed with HTTP ${result.status} for subscription ${subscription.id}` +
              (result.errorBody ? ` — ${result.errorBody}` : ""),
          );
        }
      } catch (cause) {
        failures.push(cause);
      }
    }

    // NATIVE DEVICE PUSH (#151/#165): same audience and copy as the Web Push
    // payload, plus the `kind:'missed_call'` structural discriminator so the
    // Android client routes it to the dedicated missed-calls channel
    // (PushKind.MISSED_CALL). Web Push stays kind-less — the service worker
    // renders unmarked pushes as ordinary notices and must not change shape.
    // One FCM send per registered device of every push-enabled recipient;
    // skipped with one log line until Firebase is provisioned (optional
    // secret, deploys green).
    const nativePayload = JSON.stringify({
      kind: "missed_call",
      ...(JSON.parse(payload) as Record<string, string>),
    });
    if (!isFcmConfigured(env)) {
      console.log(
        "fcm: FCM_SERVICE_ACCOUNT_JSON unset — native device push skipped",
      );
    } else {
      // #30-style defensive bound: newest 50 across the audience.
      const deviceTokens = unwrapRows<DeviceTokenRow>(
        await db
          .from("device_push_tokens")
          .select("id,user_id,platform,token")
          .in("user_id", pushUsers)
          .order("created_at", { ascending: false })
          .limit(50),
        "device push tokens lookup",
      );
      for (const device of deviceTokens) {
        try {
          const result = await sendFcm(env, device, nativePayload);
          if (result.gone) {
            // UNREGISTERED token: drop the row (the Web Push 404/410 mirror).
            const { error } = await db
              .from("device_push_tokens")
              .delete()
              .eq("id", device.id);
            if (error) {
              throw new Error(
                `dead device push token cleanup failed: ${error.message}`,
              );
            }
          } else if (!result.ok) {
            throw new Error(
              `native push delivery failed with HTTP ${result.status} for device token ${device.id}` +
                (result.errorBody ? ` — ${result.errorBody}` : ""),
            );
          }
        } catch (cause) {
          failures.push(cause);
        }
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

