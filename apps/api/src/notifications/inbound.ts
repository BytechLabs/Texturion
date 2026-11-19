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
 * active member), all active members; plus anyone who follows the thread (#694).
 * Members who muted the thread are dropped, except for an emergency. Filtered
 * per notification_prefs: a missing row reads as the §6 defaults (true/true).
 * Spam threads never reach here (the RPC reports notify=false for them).
 *
 * CHANNELS: Resend emails grouped by recipient language, and one Web
 * Push per stored subscription of every push-enabled recipient (payload:
 * contact display name + 80-char snippet + deep link, §8). 404/410 from a
 * push service deletes the dead subscription row.
 *
 * Failures are collected and thrown at the end (never silent, D3): the
 * webhook ledger records last_error, and the sweeper's replay is safe — the
 * debounce stamp is already committed, so a replay re-sends nothing.
 */
import { isLocale, NOTIFICATION_SETTING_DEFAULTS, resolveLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { canTextConversation, listConversationViewers } from "../auth/conversation-audience";
import { MAX_EMAIL_RECIPIENTS_PER_CLAIM } from "../billing/plans";
import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { contactDisplayName } from "./contact-name";
import {
  loadConversationPrefs,
  withFollowers,
  withoutMuted,
} from "./conversation-prefs";
import { deliverPush } from "./deliver";
import type { PushDelivery } from "./deliver";
import { THREAD_PUSH_COPY } from "./thread-copy";

const SNIPPET_LENGTH = 80;

const EMAIL_COPY: Record<Locale, {
  subject: (name: string) => string;
  introduction: string;
  reply: string;
  optOut: string;
}> = {
  en: {
    subject: (name) => `New text from ${name}`,
    introduction: "sent a new text:",
    reply: "Reply in Loonext",
    optOut: "Turn these alerts off",
  },
  "fr-CA": {
    subject: (name) => `Nouveau texto de ${name}`,
    introduction: "vous a envoyé un texto :",
    reply: "Répondre dans Loonext",
    optOut: "Désactiver ces alertes",
  },
};

export interface InboundNotificationInput {
  companyId: string;
  conversationId: string;
  /** Inbound message text (may be empty for media-only MMS). */
  body: string;
  /** Count of media items on the inbound message (snippet fallback). */
  mediaCount: number;
  messageId?: string;
  optedOut?: boolean;
  /**
   * #343: which channels the daily budget still allows. Push is free at both
   * ends and gets a far higher ceiling, so a workspace that has exhausted its
   * email allowance keeps getting notified on the phones — that split is the
   * whole reason the channels have separate limits.
   *
   * Defaulted so a caller that has not been updated behaves exactly as before.
   */
  allowEmail?: boolean;
  allowPush?: boolean;
  /**
   * #391: this is a LEAD — a first inbound on a new or reopened conversation,
   * rather than an append to a thread somebody is already working.
   *
   * Decides the push priority and nothing else. A NORMAL FCM message is
   * deferred during Doze, and a phone in a pocket on a job is in Doze; the
   * window Doze holds it for and the window that decides whether the job is
   * won are the same window. An append does NOT get this: Google rate-limits
   * apps that overuse high priority, and a crew that notices the battery turns
   * notifications off, which is worse than late because it is permanent.
   */
  lead?: boolean;
  beforeSend?: () => Promise<boolean>;
  replyUsers?: string[];
  optOutHint?: boolean;
  /**
   * #414: the customer replied with the emergency word the away message asked
   * for. Changes three things — the whole crew is told rather than only the
   * assignee, the push goes at HIGH priority so it wakes a phone in Doze, and
   * neither the debounce nor the daily budget applies (decided upstream).
   */
  emergency?: boolean;
  /** The first emergency in the claim window can bypass delivery holds. */
  emergencyClaimed?: boolean;
}

interface ConversationView {
  id: string;
  assigned_user_id: string | null;
  is_spam: boolean;
  phone_number_id: string | null;
  contacts: { name: string | null; phone_e164: string };
  companies?: { locale: string | null } | null;
}

interface PrefsRow {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/**
 * §8 snippet: first 80 chars of the text, or a media/message fallback.
 *
 * The customer's own words are never touched; only the two fallbacks are ours.
 */
export function notificationSnippet(
  body: string,
  mediaCount: number,
  locale: Locale,
): string {
  const text = body.trim().replaceAll(/\s+/g, " ");
  if (text.length === 0) {
    // #189: MMS is not photos-only (audio, video, contact cards, PDFs…).
    const copy = THREAD_PUSH_COPY[locale];
    return mediaCount > 0 ? copy.snippetAttachment : copy.snippetMessage;
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
        "id,assigned_user_id,is_spam,phone_number_id,contacts(name,phone_e164),companies(locale)",
      )
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const [conversation] = conversations;
  if (!conversation) {
    throw new Error(
      `notification pipeline: conversation ${input.conversationId} vanished`,
    );
  }
  // Belt-and-braces: the RPC never claims a notification for a spam thread
  // (§8 "spam-thread appends never notify"), but re-check before sending.
  if (conversation.is_spam) return;

  // Audience (§8): the assignee, else everyone who can see the thread.
  //
  // #106 is applied FIRST, so "can this person be told" is settled before the
  // assignee is singled out. An assignee who cannot be told (deactivated, or
  // access to this number revoked after the thread was assigned) falls back to
  // the whole team rather than silently alerting nobody: the customer's message
  // still reaches someone who can act on it.
  const viewers = await listConversationViewers(db, {
    companyId: input.companyId,
    phoneNumberId: conversation.phone_number_id,
  });
  const members = viewers.map((row) => row.user_id);
  //
  // #414: an EMERGENCY goes to everyone who can see the thread, assignee or
  // not. Narrowing to one person is right for an ordinary message — it is what
  // stops a crew of ten all answering the same customer — and wrong for the
  // one message where the cost of that person being asleep is a family in a
  // cold house.
  const addressed =
    !input.emergency &&
    conversation.assigned_user_id !== null &&
    members.includes(conversation.assigned_user_id)
      ? [conversation.assigned_user_id]
      : input.replyUsers?.filter((id) => members.includes(id)) ?? members;
  // #694: followers join an assigned thread's audience, and a mute removes a
  // member from it. An emergency ignores mute for the same reason it ignores
  // the assignee: the cost of one person having silenced the thread is a
  // customer nobody answered.
  const threadPrefs = await loadConversationPrefs(
    db,
    input.companyId,
    input.conversationId,
  );
  const withFollowing = withFollowers(addressed, threadPrefs, members);
  const audience = input.emergency
    ? withFollowing
    : withoutMuted(withFollowing, threadPrefs);
  if (audience.length === 0) {
    await input.beforeSend?.();
    return;
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
  // #343: the daily ceiling is checked per channel BEFORE the per-user
  // preference, because it is a spending limit rather than a preference — a
  // member who wants email still does not get one past the company's cap.
  const emailUsers = (input.allowEmail ?? true)
    ? audience
        .filter((userId) => prefs.get(userId)?.email_enabled ?? NOTIFICATION_SETTING_DEFAULTS.email_enabled.value)
        // Apply the recipient cap across all languages for this claim.
        .slice(0, MAX_EMAIL_RECIPIENTS_PER_CLAIM)
    : [];
  const pushUsers = (input.allowPush ?? true)
    ? audience.filter((userId) => prefs.get(userId)?.push_enabled ?? NOTIFICATION_SETTING_DEFAULTS.push_enabled.value)
    : [];

  const { beforeSend } = input;
  let attempt: Promise<boolean> | undefined;
  const startDelivery = beforeSend ? () => (attempt ??= beforeSend()) : undefined;

  // The one form every alert names a customer in — shared rather than restated,
  // because the fallback to the bare number is what keeps a brand-new lead's
  // alert usable and a private copy of it is a copy that can lose it.
  const contactName = contactDisplayName(conversation.contacts);
  const writers = new Set(viewers.filter(canTextConversation).map(({ user_id }) => user_id));
  const pushTitle = (locale: Locale): string =>
    input.emergency
      ? THREAD_PUSH_COPY[locale].emergencyTitle(contactName)
      : contactName;
  // The web thread route is /inbox/[conversationId]; a /conversations/:id
  // email link would 404 (only the service worker's push normalizer knows the
  // legacy shape).
  const link = `${env.APP_ORIGIN}/inbox/${input.conversationId}`;

  const failures: unknown[] = [];

  const notifyEmail = async () => {
    if (emailUsers.length === 0) return;
    try {
      const [lookups, profiles] = await Promise.all([
        Promise.all(emailUsers.map(async (userId) => ({
          userId,
          result: await db.auth.admin.getUserById(userId),
        }))),
        db.from("profiles").select("user_id,locale").in("user_id", emailUsers),
      ]);
      if (profiles.error) failures.push(new Error(`notification email locales: ${profiles.error.message}`));
      const preferences = new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile.locale]));
      const groups = new Map<Locale, string[]>();
      const workspaceLocale = conversation.companies?.locale;
      for (const { userId, result } of lookups) {
        if (result.error) {
          // One member's lookup failing must NOT drop the email for the whole
          // team — record it as a soft failure and skip just that recipient,
          // exactly as an unresolvable member is treated as un-notifiable.
          failures.push(
            new Error(
              `auth admin lookup failed for member ${userId}: ${result.error.message}`,
            ),
          );
          continue;
        }
        const { user } = result.data;
        if (!user?.email) continue;
        const savedLocale: unknown = user.user_metadata?.locale;
        const locale = resolveLocale(preferences.get(userId), isLocale(savedLocale) ? savedLocale : workspaceLocale);
        const recipients = groups.get(locale) ?? [];
        recipients.push(user.email);
        groups.set(locale, recipients);
      }
      if (groups.size === 0) return;
      if (startDelivery && !(await startDelivery())) return;
      // The settings link lets recipients stop recurring alerts without reporting spam.
      const settingsUrl = `${env.APP_ORIGIN}/settings/notifications`;
      const sends = await Promise.allSettled(Array.from(groups, async ([locale, to]) => {
        const copy = EMAIL_COPY[locale];
        const emailSnippet = notificationSnippet(input.body, input.mediaCount, locale);
        const subject = input.emergency
          ? THREAD_PUSH_COPY[locale].emergencyTitle(contactName)
          : copy.subject(contactName);
        const text =
          `${contactName} ${copy.introduction}\n\n` +
          `"${emailSnippet}"\n\n` +
          `${copy.reply}: ${link}\n\n` +
          `${copy.optOut}: ${settingsUrl}\n`;
        await sendEmail(env, {
          to,
          subject,
          text,
          locale,
          html: emailLayout(
            `<p><strong>${escapeHtml(contactName)}</strong> ${escapeHtml(copy.introduction)}</p>` +
              `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #E8E8E0;color:#4A4D3C;">${escapeHtml(emailSnippet)}</blockquote>` +
              `<p><a href="${link}" style="color:#66801F;text-decoration:underline;">${escapeHtml(copy.reply)}</a></p>` +
              `<p style="font-size:14px;color:#6E7163;"><a href="${settingsUrl}" style="color:#6E7163;">${escapeHtml(copy.optOut)}</a></p>`,
            locale,
          ),
          headers: { "List-Unsubscribe": `<${settingsUrl}>` },
        });
      }));
      for (const result of sends) {
        if (result.status === "rejected") failures.push(result.reason);
      }
    } catch (error) {
      failures.push(error);
    }
  };

  // WEB PUSH + NATIVE DEVICE PUSH: the §8 payload (contact display name,
  // 80-char snippet, deep link) to every push-enabled recipient. #162 iOS
  // coalescing: repeat texts in one thread REPLACE the pending alert rather
  // than stacking, on the `conversation:<id>` tag the clients coalesce on.
  const push: Omit<PushDelivery, "category" | "userIds"> = {
    beforeSend: startDelivery,
    companyId: input.companyId,
    conversationId: input.conversationId,
    // #430: the customer's words. When the workspace has content off, the
    // name still rides — the title is untouched — and only the snippet goes.
    // "Sent you a message" rather than a bare "New message": the tech still
    // learns there is something from THIS person waiting, which is the triage
    // #388 depends on.
    content: input.optOutHint ? { written: "us" } : {
      written: "people",
      companyId: input.companyId,
      withheld: (locale) => ({
        body: THREAD_PUSH_COPY[locale].inboundWithheldBody,
      }),
    },
    web: (locale) => ({
      title: input.optOutHint ? THREAD_PUSH_COPY[locale].optOutHintTitle : pushTitle(locale),
      body: input.optOutHint
        ? THREAD_PUSH_COPY[locale].optOutHintBody
        : notificationSnippet(input.body, input.mediaCount, locale),
      url: link,
    }),
    // #564: the phones had nothing to route on, so an URGENT text posted to the
    // ordinary Messages channel at ordinary importance — silenced by the same
    // switch as "on my way?" — while the reply we send that customer says the
    // crew has been alerted. The discriminator is what makes that sentence true:
    // Android gives it its own high-importance channel, and iOS marks it
    // time-sensitive so it breaks through a Focus.
    //
    // NATIVE only, deliberately. The service worker renders every push the same
    // way and has no channels to pick from, so a `kind` there would be a field
    // nothing reads — and `web` is the payload a browser can inspect.
    native: input.emergency
      ? (locale) => ({
          title: pushTitle(locale),
          body: notificationSnippet(input.body, input.mediaCount, locale),
          url: link,
          kind: "emergency",
        })
      : undefined,
    nativeAction: (userId) => input.messageId ? {
      kind: "message",
      conversationId: input.conversationId,
      messageId: input.messageId,
      sender: contactName,
      canReply: !input.optedOut && writers.has(userId),
    } : undefined,
    collapseKey: input.emergency
      ? // #414: an emergency must NOT be coalesced away by the ordinary texts
        // that follow it in the same thread. Its own key keeps it on the lock
        // screen instead of being replaced by "on my way?" thirty seconds
        // later.
        `emergency:${input.conversationId}`
      : `conversation:${input.conversationId}`,
    // #414: HIGH wakes a phone in Doze; NORMAL is deferred, which is exactly
    // where this promise died. Same urgency an incoming call already uses.
    // #414 emergency and #391 lead both need to wake a sleeping phone. An
    // ordinary append stays NORMAL, deliberately — see `lead` above for why
    // "set everything HIGH" is the wrong answer.
    //
    // #452: the two reasons are recorded separately rather than collapsed to a
    // flag, because only one of them is capped. An emergency is four fixed
    // words a customer typed; a lead scales with inbound volume, which is the
    // input an outsider controls, so it is the one with a ceiling.
    highPriority: input.emergency
      ? { companyId: input.companyId, reason: "emergency" }
      : (input.lead
        ? { companyId: input.companyId, reason: "lead" }
        : undefined),
    overridesQuietHours: input.emergencyClaimed
      ? { reason: "emergency" }
      : undefined,
    failures,
  };
  const assignee = conversation.assigned_user_id;
  const results = await Promise.allSettled([
    deliverPush(env, db, {
      ...push,
      category: "messages_mine",
      userIds: assignee && pushUsers.includes(assignee) ? [assignee] : [],
    }),
    deliverPush(env, db, {
      ...push,
      category: "messages_all",
      userIds: pushUsers.filter((userId) => userId !== assignee),
    }),
    notifyEmail(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `notification pipeline: ${failures.length} delivery step(s) failed for conversation ${input.conversationId}`,
    );
  }
  if (!attempt) await startDelivery?.();
}
