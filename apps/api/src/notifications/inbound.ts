/**
 * The §8 inbound-message notification pipeline, run as the last step of the
 * `message.received` dispatch (SPEC §7).
 *
 * DEBOUNCE lives in the threading transaction: thread_inbound_message applies
 * the §8 trigger (conversation new/reopened by inbound, or first inbound with
 * `last_notified_at IS NULL OR < now() - 15 min`), stamps `last_notified_at`
 * atomically, and reports the decision as `notify` — so this module only runs
 * when the claim was won, and concurrent deliveries can never double-send.
 *
 * AUDIENCE: the assignee; if unassigned (or the assignee is no longer an
 * active member), all active members. Filtered per notification_prefs — a
 * missing row reads as the §6 defaults (true/true). Spam threads never reach
 * here (the RPC reports notify=false for them).
 *
 * CHANNELS: one Resend email to every email-enabled recipient, and one Web
 * Push per stored subscription of every push-enabled recipient (payload:
 * contact display name + 80-char snippet + deep link, §8). 404/410 from a
 * push service deletes the dead subscription row.
 *
 * Failures are collected and thrown at the end (never silent, D3): the
 * webhook ledger records last_error, and the sweeper's replay is safe — the
 * debounce stamp is already committed, so a replay re-sends nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { levelFromRules, type NumberAccessRule } from "../auth/number-access";
import type { MemberRole } from "../context";
import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { sendWebPush } from "./webpush";

const SNIPPET_LENGTH = 80;

export interface InboundNotificationInput {
  companyId: string;
  conversationId: string;
  /** Inbound message text (may be empty for media-only MMS). */
  body: string;
  /** Count of media items on the inbound message (snippet fallback). */
  mediaCount: number;
}

interface ConversationView {
  id: string;
  assigned_user_id: string | null;
  is_spam: boolean;
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

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/** §8 snippet: first 80 chars of the text, or a media/message fallback. */
export function notificationSnippet(body: string, mediaCount: number): string {
  const text = body.trim().replace(/\s+/g, " ");
  if (text.length === 0) {
    return mediaCount > 0 ? "Sent a photo" : "Sent a message";
  }
  return text.length <= SNIPPET_LENGTH
    ? text
    : `${text.slice(0, SNIPPET_LENGTH - 1)}…`;
}

export async function notifyInboundMessage(
  env: Env,
  input: InboundNotificationInput,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const conversations = unwrapRows<ConversationView>(
    await db
      .from("conversations")
      .select(
        "id,assigned_user_id,is_spam,phone_number_id,contacts(name,phone_e164)",
      )
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const conversation = conversations[0];
  if (!conversation) {
    throw new Error(
      `notification pipeline: conversation ${input.conversationId} vanished`,
    );
  }
  // Belt-and-braces: the RPC never claims a notification for a spam thread
  // (§8 "spam-thread appends never notify"), but re-check before sending.
  if (conversation.is_spam) return;

  // Audience (§8): assignee, else all active members. An assignee who is no
  // longer an active member cannot be notified, so the thread falls back to
  // the whole team rather than silently alerting nobody.
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

  // #106: never alert a member who can't see this number — the snippet + contact
  // name would leak a hidden conversation. Notes-only members CAN read the
  // thread, so only level 'none' is dropped; owners/admins always keep access.
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

  // Per-user prefs; a missing row carries the §6 defaults (true/true).
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
  const snippet = notificationSnippet(input.body, input.mediaCount);
  // The web thread route is /inbox/[conversationId]; a /conversations/:id
  // email link would 404 (only the service worker's push normalizer knows the
  // legacy shape).
  const link = `${env.APP_ORIGIN}/inbox/${input.conversationId}`;

  const failures: unknown[] = [];

  // EMAIL — addresses live in auth.users (GoTrue admin API, same credential
  // path as everywhere else); one email to all enabled recipients.
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
        // Recurring notification email: carry an opt-out path (settings
        // footer + List-Unsubscribe header) so recipients can stop the
        // stream without marking it spam. Billing/operational alerts do NOT
        // get this — they are not optional.
        const settingsUrl = `${env.APP_ORIGIN}/settings/notifications`;
        const text =
          `${contactName} sent a new text:\n\n` +
          `"${snippet}"\n\n` +
          `Reply in Loonext: ${link}\n\n` +
          `Turn these alerts off: ${settingsUrl}\n`;
        await sendEmail(env, {
          to,
          subject: `New text from ${contactName}`,
          text,
          html: emailLayout(
            `<p><strong>${escapeHtml(contactName)}</strong> sent a new text:</p>` +
              `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #e6e8ec;color:#3b4252;">${escapeHtml(snippet)}</blockquote>` +
              `<p><a href="${link}" style="color:#2740de;text-decoration:underline;">Reply in Loonext</a></p>` +
              `<p style="font-size:14px;color:#7a828c;"><a href="${settingsUrl}" style="color:#7a828c;">Turn these alerts off</a></p>`,
          ),
          headers: { "List-Unsubscribe": `<${settingsUrl}>` },
        });
      }
    } catch (cause) {
      failures.push(cause);
    }
  }

  // WEB PUSH — payload consumed by the apps/web service worker (§8: contact
  // display name + 80-char snippet + deep link).
  if (pushUsers.length > 0) {
    // #30 defensive bound: POST /v1/push-subscriptions caps each user at 10
    // live rows, but a bad table state must never unbound webhook processing —
    // newest 50 across the audience is far above any legitimate team's devices.
    const subscriptions = unwrapRows<SubscriptionRow>(
      await db
        .from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth")
        .in("user_id", pushUsers)
        .order("created_at", { ascending: false })
        .limit(50),
      "push subscriptions lookup",
    );
    const payload = JSON.stringify({
      title: contactName,
      body: snippet,
      url: link,
    });
    for (const subscription of subscriptions) {
      try {
        const result = await sendWebPush(env, subscription, payload);
        if (result.gone) {
          // Permanently dead endpoint (unsubscribed/expired): drop the row.
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
      `notification pipeline: ${failures.length} delivery step(s) failed for conversation ${input.conversationId}`,
    );
  }
}

