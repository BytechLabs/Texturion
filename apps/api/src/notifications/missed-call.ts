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
import type { Locale, VoicemailIntake } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { canTextConversation, listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";
import {
  loadConversationPrefs,
  withFollowers,
  withoutMuted,
} from "./conversation-prefs";
import { deliverPush } from "./deliver";
import type { PushDelivery } from "./deliver";
import { MISSED_CALL_COPY } from "./missed-call-copy";
import { findOpenMissedCallAlert, routeAfterHoursAlert } from "./on-call";
import { NOTIFICATION_SETTING_DEFAULTS } from "@loonext/shared";

export interface MissedCallNotificationInput {
  companyId: string;
  conversationId: string;
  callSessionId: string;
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

interface VoicemailNotificationInput {
  companyId: string;
  conversationId: string;
  callSessionId: string;
  seconds: number;
  transcript: string | null;
  intake: VoicemailIntake | null;
}

type CallActivityInput =
  | (MissedCallNotificationInput & { kind: "missed_call" })
  | (VoicemailNotificationInput & { kind: "voicemail" });

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
  return notifyCallActivity(env, db, { ...input, kind: "missed_call" });
}

export function notifyVoicemail(
  env: Env,
  db: SupabaseClient,
  input: VoicemailNotificationInput,
): Promise<void> {
  return notifyCallActivity(env, db, { ...input, kind: "voicemail" });
}

async function notifyCallActivity(
  env: Env,
  db: SupabaseClient,
  input: CallActivityInput,
): Promise<void> {
  const voicemail = input.kind === "voicemail";
  const conversations = unwrapRows<ConversationView>(
    await db
      .from("conversations")
      .select("id,assigned_user_id,phone_number_id,contacts(name,phone_e164)")
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const [conversation] = conversations;
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
  const writers = new Set(viewers.filter(canTextConversation).map(({ user_id }) => user_id));
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
  const openAlert = voicemail ? await findOpenMissedCallAlert(db, input) : null;
  const existingAlert = openAlert && members.includes(openAlert.on_call_user_id)
    ? openAlert
    : null;
  const routing = voicemail ? null : await routeAfterHoursAlert(db, {
    companyId: input.companyId,
    conversationId: input.conversationId,
    phoneNumberId: conversation.phone_number_id,
    kind: "missed_call",
    callSessionId: input.callSessionId,
    audience: assigned,
  });
  const threadPrefs = await loadConversationPrefs(
    db,
    input.companyId,
    input.conversationId,
  );
  const routedUsers = existingAlert
    ? [existingAlert.on_call_user_id]
    : withFollowers(routing?.userIds ?? assigned, threadPrefs, members);
  const audience = withoutMuted(routedUsers, threadPrefs);
  if (audience.length === 0) return;

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
    (userId) => prefs.get(userId)?.push_enabled ?? NOTIFICATION_SETTING_DEFAULTS.push_enabled.value,
  );

  const contactName =
    conversation.contacts.name?.trim() || conversation.contacts.phone_e164;
  // The web thread route is /inbox/[conversationId] (the /conversations/:id
  // shape only exists inside the service worker's legacy-push normalizer).
  const link = `${env.APP_ORIGIN}/inbox/${input.conversationId}`;

  const failures: unknown[] = [];

  // #228: composed per reader rather than built once. Which of the three
  // bodies this miss gets is decided HERE, where the status is; the copy table
  // owns what each one says in each language.
  const voicemailText = voicemail ? voicemailPreview(input) : null;
  const alert = (locale: Locale) => {
    const copy = MISSED_CALL_COPY[locale];
    if (voicemail) {
      return {
        title: copy.voicemailTitle(contactName),
        body: voicemailText ?? copy.voicemailDuration(input.seconds),
        url: link,
      };
    }
    const bodyKey = input.textStatus === "sent"
      ? "bodyTexted"
      : input.textStatus === "failed" ? "bodyTextFailed" : "bodyNoText";
    // The contact's name is theirs and rides through untranslated.
    return { title: copy.title(contactName), body: copy[bodyKey], url: link };
  };
  const delivery = {
    category: voicemail ? "voicemails" : "missed_calls",
    companyId: input.companyId,
    conversationId: input.conversationId,
    userIds: pushUsers,
    content: voicemailText ? {
      written: "people",
      companyId: input.companyId,
      withheld: (locale) => ({ body: MISSED_CALL_COPY[locale].voicemailBody }),
    } : { written: "us" },
    web: (locale) => ({
      ...alert(locale),
      kind: "missed_call",
      call_session_id: input.callSessionId,
    }),
    native: (locale) => ({
      kind: "missed_call",
      ...(existingAlert ? { alert_id: existingAlert.id } : {}),
      ...alert(locale),
    }),
    nativeAction: (userId) => !voicemail && writers.has(userId) ? {
      kind: "missed_call",
      conversationId: input.conversationId,
      callbackNumber: input.callerE164,
    } : undefined,
    collapseKey: `conversation:${input.conversationId}`,
    failures,
  } satisfies PushDelivery;

  if (routing?.alertId) {
    const { alertId } = routing;
    const pageUsers = pushUsers.filter((userId) => routing.userIds.includes(userId));
    const followers = pushUsers.filter((userId) => !routing.userIds.includes(userId));
    await Promise.all([
      deliverPush(env, db, { ...delivery, userIds: followers }),
      deliverPush(env, db, {
        ...delivery,
        userIds: pageUsers,
        overridesQuietHours: { reason: "on_call_page" },
        highPriority: { companyId: input.companyId, reason: "on_call_page" },
        native: (locale) => ({ ...delivery.native(locale), alert_id: alertId }),
      }),
    ]);
  } else {
    await deliverPush(env, db, delivery);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `missed-call alert: ${failures.length} delivery step(s) failed for conversation ${input.conversationId}`,
    );
  }
}

function voicemailPreview(input: VoicemailNotificationInput): string | null {
  const problem = input.intake?.problem?.trim();
  const address = input.intake?.address?.trim();
  const transcript = input.transcript?.trim();
  if (problem && address) return `${problem} · ${address}`;
  if (!transcript) return null;
  return Array.from(transcript).slice(0, 140).join("");
}

