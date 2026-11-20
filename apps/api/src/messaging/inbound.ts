/**
 * Inbound pipeline for Telnyx `message.received` (SPEC §4, §5, §6, §7):
 *
 *   resolve the receiving number → thread_inbound_message RPC (the atomic §6
 *   threading transaction) → STOP/START standalone-keyword handling (§5) →
 *   MMS media download into Storage + message_attachments (idempotent; at
 *   most the first 10 items per message, D30) →
 *   notification pipeline (§8, only when the RPC won the debounce claim).
 *
 * Every step is idempotent, so the §11 sweeper can replay the event safely:
 * the RPC dedupes on telnyx_message_id (side effects gated on `created`),
 * media downloads skip attachment rows that already exist, and the §8
 * debounce stamp commits with the threading transaction so a replay never
 * re-notifies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalMmsType, companySettingDefault, looksLikeOptOut, parseTapback } from "@loonext/shared";

import { PLAN_NOTIFY_LIMITS } from '../billing/plans';
import type { PlanId } from '../billing/plans';
import { billingRecipients } from "../billing/recipients";

import { capture } from "../analytics/posthog";
import { recordAudit } from "../audit/log";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { deadline } from "../http/deadline";
import { ApiError } from "../http/errors";
import { notifyInboundMessage } from "../notifications/inbound";
import { clearSavedInboundAlert, deliverSavedInboundAlert } from "../notifications/pending-inbound";
import type { CrewNotifyVerdict } from "../notifications/pending-inbound";
import { captureEvent, errorLogText, reportHandledFailure } from "../observability/capture";
import { phoneCountry } from "./delivery-by-country";
import { classifyInbound } from "./spam-flag";
import { stripImageLocation } from "../attachments/location";
import { qualifyReferralForSender } from "../referrals/referrals";
import { scanAttachment } from "../attachments/scan";
import { bytesMatchDeclaredType } from "../routes/core/attachments";
import type { ConversationEventRow } from "../routes/core/events";
import { listCarrierOptOuts } from "../telnyx/opt-outs";
import { enqueueWebhookEvent } from "../webhooks/outbound";
import { maybeSendAwayReply } from "./away-reply";
import { maybeSendOffRamp } from "./off-ramp";
import { sendEmergencyAcknowledgment } from "./emergency-ack";
import { sendHelpReply } from "./help-reply";
import { budgetAlertCopy, budgetCrossings } from './notification-budget-alert';
import type { BudgetCrossing } from './notification-budget-alert';
import {
  effectiveEmergencyKeywords,
  helpKeywordLocale,
  isCarrierKeyword,
  isEmergencyKeyword,
  isFrenchHelpKeyword,
  isFrenchStopRequest,
  normaliseKeyword,
  START_KEYWORDS,
  STOP_KEYWORDS,
} from "./keywords";
import { confirmAppointmentFromReply } from "./appointment-reminders";
import { escalatePoorRating, recordRatingFromReply } from "./job-ratings";
import {
  INBOUND_MEDIA_TYPES,
  MAX_INBOUND_MEDIA_BYTES,
  MAX_INBOUND_MEDIA_ITEMS,
  mediaStoragePath,
  MMS_BUCKET,
} from "./media";
import { sendFrenchOptOutConfirmation } from "./send";
import type { TelnyxEvent, ThreadResult } from "./types";

const INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000;
export const INBOUND_COMPANY_COLUMNS =
  "timezone,plan,notify_email_limit,notify_push_limit," +
  "emergency_keyword_enabled,emergency_keywords,emergency_message," +
  "first_inbound_reply_at,country,us_texting_enabled,locale,name,subscription_status,telnyx_messaging_profile_id";

export interface InboundCompany {
  timezone?: string | null;
  plan?: PlanId | null;
  notify_email_limit?: number | null;
  notify_push_limit?: number | null;
  emergency_keyword_enabled?: boolean | null;
  emergency_keywords?: string[] | null;
  emergency_message?: string | null;
  first_inbound_reply_at?: string | null;
  country?: string | null;
  us_texting_enabled?: boolean | null;
  locale?: string | null;
  name?: string | null;
  subscription_status?: string | null;
  telnyx_messaging_profile_id?: string | null;
}

export function inboundNotificationLimits(company: InboundCompany | null): { email: number; push: number } {
  const defaults = PLAN_NOTIFY_LIMITS[company?.plan ?? "starter"] ?? PLAN_NOTIFY_LIMITS.starter;
  return {
    email: company?.notify_email_limit ?? defaults.email,
    push: company?.notify_push_limit ?? defaults.push,
  };
}

/**
 * The threading RPC's return with the #39 additive key: `notification_alert`
 * is 80/100 exactly once per (company, UTC day) when this claim crossed that
 * percentage of the daily inbound-notification allowance, else null/absent.
 */
export type InboundThreadResult = ThreadResult & {
  crew_notify_state?: "none" | "pending" | "attempted";
  crew_notify_verdict?: CrewNotifyVerdict | null;
  contact_id?: string;
  notification_alert?: number | null;
  /**
   * #343: the per-channel verdicts and the crossings, both additive. An older
   * database returns neither, and the fallbacks below reproduce today's
   * behaviour exactly — one budget, both channels together.
   */
  notify_email?: boolean;
  notify_push?: boolean;
  notification_alerts?: { channel: "email" | "push"; threshold: number }[];
  /**
   * #391: WHICH §8 trigger fired. 'new' and 'reopened' are LEADS — the push
   * has to wake a phone in Doze, because a reply inside five minutes converts
   * roughly 21x better than one at thirty and Doze holds a NORMAL message for
   * longer than that. 'append' is a thread somebody is already working and is
   * not worth the battery or the rate limit.
   *
   * Absent on an older database, and the fallback is 'append' — the safe
   * direction, since it is exactly today's behaviour.
   */
  notify_reason?: "new" | "reopened" | "append" | "reaction";
  allow_automated_reply?: boolean;
};

interface ThreadedInboundInput {
  threaded: InboundThreadResult;
  companyId: string;
  company: InboundCompany | null;
  fromE164: string;
  toE164: string;
  body: string;
  segments: number | null;
  mediaCount: number;
  receivedMediaCount?: number;
  emergency?: boolean;
  source: "carrier" | "widget";
  carrierResponse?: string;
  receivingNumberActive?: boolean;
}

function isInboundEmergency(company: InboundCompany | null, body: string): boolean {
  return (company?.emergency_keyword_enabled ?? companySettingDefault("emergency_keyword_enabled")) &&
    isEmergencyKeyword(body, effectiveEmergencyKeywords(company?.emergency_keywords)) &&
    !isCarrierKeyword(body) && !isFrenchHelpKeyword(body);
}

/**
 * #281 — the REPLY half of D12 activation: "sends its first outbound SMS AND
 * receives an inbound reply within 7 days of payment."
 *
 * Fires once per workspace, the first time an inbound lands on a conversation
 * we had ALREADY texted. That qualifier is the whole point: an inbound on a
 * thread the customer started is the product working, but it is not a reply to
 * us, and counting it would overstate activation the same way measuring only
 * the outbound half did.
 *
 * `companies.first_inbound_reply_at` is the ledger rather than a heuristic
 * count, so "first" is exact and the 7-day window stays computable in SQL next
 * to the subscription dates it has to be compared against. The stamp is guarded
 * on null, so two replies arriving together produce one event.
 *
 * Best-effort throughout, and deliberately so: the inbound message is already
 * durable and threaded by the time this runs. Analytics must never wedge a
 * customer's incoming text in a retry loop.
 *
 * #288: the name is now half right. This stamps the ACTIVATION — a product fact
 * that reports read and that a referral payout turns on — and then, only if
 * analytics is configured, sends the event about it.
 */
async function captureFirstInboundReply(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    messageId: string;
    alreadyStampedAt: string | null | undefined;
    country: string | null | undefined;
    usTextingEnabled: boolean | null | undefined;
  },
): Promise<void> {
  // #288: the POSTHOG gate used to wrap this WHOLE function, which meant
  // `first_inbound_reply_at` — a product column that reports read and that a
  // referral payout now turns on — was written only as a side effect of analytics
  // being configured. Turning analytics off would have quietly stopped every
  // workspace from ever counting as activated, and stopped paying referrers.
  //
  // The stamp is the product fact and always runs. Only the event below is gated.
  if (args.alreadyStampedAt) return; // the loop closed long ago
  try {
    // A reply needs something to reply TO: one of OUR dispatched outbounds on
    // this thread. Cheap and indexed, and it runs only until the workspace's
    // first reply is stamped.
    const { data, error } = await db
      .from("messages")
      .select("id")
      .eq("company_id", args.companyId)
      .eq("conversation_id", args.conversationId)
      .eq("direction", "outbound")
      .not("telnyx_message_id", "is", null)
      .limit(1);
    if (error) throw new Error(`reply-precedent lookup failed: ${error.message}`);
    if ((data ?? []).length === 0) return; // customer-initiated thread, not a reply

    // Claim it. The null guard is what makes this once-per-workspace under
    // concurrent replies; the loser updates no row and emits nothing.
    const stamped = await db
      .from("companies")
      .update({ first_inbound_reply_at: new Date().toISOString() })
      .eq("id", args.companyId)
      .is("first_inbound_reply_at", null)
      .select("id");
    if (stamped.error) {
      throw new Error(`activation stamp failed: ${stamped.error.message}`);
    }
    if ((stamped.data ?? []).length === 0) return; // somebody else stamped it

    // #369: Canada-only and US-enabled workspaces have structurally different
    // time-to-value — a Canada-only workspace has no registration wait at all —
    // so averaging them hides both. Two booleans, no free text.
    if (env.POSTHOG_API_KEY) {
      await capture(env, "first_inbound_reply", args.companyId, {
        country: args.country ?? "unknown",
        us_texting_enabled: args.usTextingEnabled === true,
      });
    }

    // #288 — this is the moment a referral is earned, so it is the moment to say so.
    //
    // The payout now requires D12 activation, which is exactly the line just
    // crossed. Without this call the referral would wait for the referee's NEXT
    // send, and a workspace that sends once and gets a reply — the most ordinary
    // possible start — would leave its referrer unpaid until they happened to text
    // somebody again. Nobody would ever have reported that as a bug.
    //
    // Rides the same never-throws contract as everything else in this block: a
    // referral bookkeeping problem must not fail a customer's inbound message.
    await qualifyReferralForSender(env, db, args.companyId);
  } catch (error) {
    void reportHandledFailure(env, "first-inbound-reply-record", error, {
      ids: { companyId: args.companyId },
    });
  }
}

/** message.received entry point (dispatched from /webhooks/telnyx, §7). */
export async function handleInboundMessage(
  env: Env,
  event: TelnyxEvent,
): Promise<void> {
  const payload = event.data?.payload;
  const telnyxMessageId = payload?.id;
  const fromE164 = payload?.from?.phone_number;
  const toE164 = payload?.to?.find(
    (recipient) => typeof recipient.phone_number === "string",
  )?.phone_number;
  if (!payload || !telnyxMessageId || !fromE164 || !toE164) {
    // Unusable payload: acked no-op (§7) — nothing to retry.
    console.warn("message.received with unusable payload — ignored");
    return;
  }

  const db = getDb(env);

  // Resolve the receiving number → (company, phone_number). A number we do
  // not know (e.g. released) is an acked no-op.
  const { data: numbers, error: numberError } = await db
    .from("phone_numbers")
    // #343: the company row rides along on the lookup this path already makes,
    // so the notification budget costs ZERO extra round trips on the hot
    // inbound path — the timezone that decides when the day ends, and the plan
    // whose ceilings apply, plus any ops override.
    .select(`id,company_id,status,companies(${INBOUND_COMPANY_COLUMNS})`)
    .eq("number_e164", toE164)
    .neq("status", "released")
    .limit(1);
  if (numberError) {
    throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
  }
  const number = (numbers ?? [])[0] as unknown as
    | { id: string; company_id: string; status: string; companies?: InboundCompany | null }
    | undefined;
  if (!number) {
    console.warn(`message.received for unknown number — ignored`);
    return;
  }

  const company = number.companies ?? null;
  const limits = inboundNotificationLimits(company);

  const body = payload.text ?? "";
  const emergency = isInboundEmergency(company, body);

  const media = (payload.media ?? []).filter(
    (item): item is { url: string; content_type?: string; size?: number } =>
      typeof item.url === "string" && item.url.length > 0,
  );

  const optOutHint = !isFrenchStopRequest(body) && looksLikeOptOut(body);
  // The §6 threading transaction, atomically in the database.
  const reaction = payload.media?.length ? null : parseTapback(body);
  const occurrence = event.data?.occurred_at;
  const occurredAt = typeof occurrence === "string" ? Date.parse(occurrence) : Number.NaN;
  const { data, error } = await db.rpc("thread_inbound_message", {
    p_company_id: number.company_id,
    p_phone_number_id: number.id,
    p_from_e164: fromE164,
    p_body: body,
    p_telnyx_message_id: telnyxMessageId,
    p_timezone: company?.timezone ?? null,
    p_email_limit: limits.email,
    p_push_limit: limits.push,
    p_notify_emergency: emergency,
    p_notify_media_count: media.length,
    p_occurred_at: Number.isFinite(occurredAt) ? new Date(occurredAt).toISOString() : null,
    ...(reaction ? { p_reaction: reaction } : {}),
    ...(optOutHint ? { p_notify_opt_out_hint: true } : {}),
  });
  if (error) throw new Error(`thread_inbound_message failed: ${error.message}`);
  const threaded = data as InboundThreadResult | null;
  if (!threaded?.message_id || !threaded.conversation_id) {
    throw new Error("thread_inbound_message returned no message");
  }
  if (threaded.notify_reason === "reaction") return;

  await finishThreadedInbound(env, db, {
    threaded,
    companyId: number.company_id,
    company,
    fromE164,
    toE164,
    body,
    segments: typeof payload.parts === "number" ? payload.parts : null,
    mediaCount: media.length,
    receivedMediaCount: payload.media?.length ?? 0,
    emergency,
    source: "carrier",
    carrierResponse: typeof payload.autoresponse_type === "string"
      ? payload.autoresponse_type.toUpperCase()
      : undefined,
    receivingNumberActive: number.status === "active",
  });

  // Notify first so a retryable download failure cannot suppress the alert.
  if (media.length > 0) {
    await downloadInboundMedia(db, {
      companyId: number.company_id,
      conversationId: threaded.conversation_id,
      messageId: threaded.message_id,
      media,
    });
  }
}

export async function finishThreadedInbound(
  env: Env,
  db: SupabaseClient,
  input: ThreadedInboundInput,
): Promise<void> {
  const { threaded, companyId, company, fromE164, toE164, body, segments, mediaCount, source } = input;
  const carrier = source === "carrier";
  const frenchStop = carrier && isFrenchStopRequest(body);
  const limits = inboundNotificationLimits(company);
  const emergency = input.emergency ?? isInboundEmergency(company, body);

  // #281 activation: the reply half of D12, once per workspace. Gated on the
  // first delivery so a §11 sweeper replay cannot re-emit it, and awaited
  // because it never rejects.
  if (threaded.created) {
    await captureFirstInboundReply(env, db, {
      companyId,
      conversationId: threaded.conversation_id,
      messageId: threaded.message_id,
      alreadyStampedAt: company?.first_inbound_reply_at,
      country: company?.country,
      usTextingEnabled: company?.us_texting_enabled,
    });
    // D146: the inbound side of `message_sent`, with the sender's country.
    void captureEvent(env, "message_received", companyId, {
      direction: "inbound",
      country: phoneCountry(fromE164),
      segments,
      media_count: input.receivedMediaCount ?? mediaCount,
    });
  }

  // #243: tell the workspace's own systems. Gated on `created` for the same
  // reason the activation capture above is — the §11 sweeper replays this
  // handler on failure, and an integration that receives the same message
  // twice as two DIFFERENT events (different delivery ids) is one that books
  // the job twice.
  //
  // Awaited rather than fired and forgotten, because this path has no
  // execution context to hand a promise to and a dropped enqueue is an event
  // the customer never learns about. `enqueueWebhookEvent` cannot throw and
  // cannot slow anything down when nobody is subscribed: it is one indexed
  // lookup that returns no rows.
  if (threaded.created) {
    await enqueueWebhookEvent(db, {
      companyId,
      type: "message.received",
      data: {
        message_id: threaded.message_id,
        conversation_id: threaded.conversation_id,
        from: fromE164,
        to: toE164,
        body,
        ...(source === "widget" ? { source } : {}),
      },
    });
  }

  // Opt-out keyword handling runs on EVERY delivery. The opt_outs mirror is the
  // source of truth the send gate + inbox rely on, so a first-delivery failure
  // must be recoverable: the §11 sweeper replays the event (created=false), and
  // gating the WHOLE handler on `created` would drop the STOP forever — we'd
  // keep texting someone who opted out (a compliance miss). The mirror writes
  // are idempotent (upsert / revoke-if-active); only the conversation_events
  // timeline insert is gated on the first delivery so a replay can't double-log.
  // Genuine duplicate webhooks never reach here — they're deduped at the
  // webhook_events ledger — so `created` is false only on a failure replay.
  let keywordFailure: { error: unknown } | undefined;
  let carrierOwnedIt = false;
  try {
    carrierOwnedIt = carrier && await handleOptOutKeywords(env, db, {
      companyId,
      conversationId: threaded.conversation_id,
      fromE164,
      body,
      recordEvent: threaded.created,
      wasOptedOut: threaded.opted_out,
      carrierProfileId: company?.telnyx_messaging_profile_id,
      carrierResponse: input.carrierResponse,
    });
  } catch (error) {
    keywordFailure = { error };
  }

  // YES and OUI from an opted-out contact belong to the opt-in handler first.
  //
  // Best-effort: the inbound message is already durable, and a job that could
  // not be marked confirmed must never wedge a delivery in a retry loop.
  if (carrier && !keywordFailure && !carrierOwnedIt && threaded.created) {
    try {
      await confirmAppointmentFromReply(db, {
        companyId,
        conversationId: threaded.conversation_id,
        body,
      });
    } catch (error_) {
      void reportHandledFailure(env, "inbound-appointment-confirmation", error_);
    }

    // #313: "5" answering "how did it go?". Behind the same carrier gate and
    // for the same reason, and disjoint from the confirmation above — that
    // reads words, this reads a bare digit, so no reply can be both.
    //
    // Best-effort for the same reason too: the inbound message is already
    // durable, and a rating that could not be recorded must never wedge a
    // delivery in a retry loop.
    try {
      const rated = await recordRatingFromReply(db, {
        companyId,
        conversationId: threaded.conversation_id,
        body,
      });
      // A bad answer is not a statistic to read next month. Inside the same
      // try: the rating is already written and on the thread, so a push that
      // fails degrades the alert rather than losing the score.
      if (rated) {
        await escalatePoorRating(env, db, {
          companyId,
          conversationId: threaded.conversation_id,
          taskId: rated.taskId,
          score: rated.score,
        });
      }
    } catch (error_) {
      void reportHandledFailure(env, "inbound-job-rating-record", error_);
    }
  }

  // #250: does this look like a robotext, or did somebody block this sender?
  // Runs before the notification decision below and after the message is
  // durable, so a classifier failure can only cost a badge.
  const pendingAlert = threaded.crew_notify_state === "pending";
  const spam = threaded.created || pendingAlert
    ? await classifyInbound(db, {
        companyId,
        conversationId: threaded.conversation_id,
        fromE164,
        body,
      })
    : { blocked: false, suspected: false };

  const optOutHint = !frenchStop && looksLikeOptOut(body);
  // Widget submissions use the original threading overload.
  if (!carrier && optOutHint && threaded.created) {
    try {
      await db
        .from("conversations")
        .update({ opt_out_hint_at: new Date().toISOString() })
        .eq("id", threaded.conversation_id)
        .eq("company_id", companyId);
      // #345/D22: "we were told, and we knew" is the fact that matters if this
      // is ever disputed. The actor is the CONTACT, not a member.
      await recordAudit(db, {
        companyId,
        actorUserId: null,
        action: "opt_out.language_detected",
        targetType: "conversation",
        targetId: threaded.conversation_id,
        after: { from: fromE164 },
      });
    } catch (error_) {
      void reportHandledFailure(env, "inbound-opt-out-language", error_, {
        ids: { conversationId: threaded.conversation_id },
      });
    }
  }

  // Notify the crew before attempting any carrier reply.
  const allowEmail = threaded.notify_email ?? threaded.notify;
  const allowPush = threaded.notify_push ?? threaded.notify;

  // Emergencies bypass the budget and spam heuristics. A crew block still applies.
  if (threaded.created && !emergency && spam.suspected) {
    console.log(
      `inbound spam suspected on conversation ${threaded.conversation_id}: ` +
        `notification suppressed, thread left in the inbox`,
    );
  }
  const spamSilences = spam.blocked || (!emergency && spam.suspected);

  let notificationFailure: { error: unknown } | undefined;
  try {
    if (pendingAlert && threaded.crew_notify_verdict) {
      await (spamSilences
        ? clearSavedInboundAlert(db, companyId, threaded.message_id)
        : deliverSavedInboundAlert(env, db, {
            messageId: threaded.message_id,
            companyId,
            conversationId: threaded.conversation_id,
            body,
            verdict: threaded.crew_notify_verdict,
            requireUnread: !threaded.created,
          }));
    } else if (
      threaded.crew_notify_state === undefined &&
      threaded.created && !spamSilences && (emergency || allowEmail || allowPush)
    ) {
      await notifyInboundMessage(
        env,
        {
          companyId,
          conversationId: threaded.conversation_id,
          messageId: threaded.message_id,
          optedOut: threaded.opted_out,
          body,
          mediaCount,
          allowEmail: emergency || allowEmail,
          allowPush: emergency || allowPush,
          emergency,
          lead: threaded.notify_reason === "new" || threaded.notify_reason === "reopened",
        },
        db,
      );
    }
  } catch (error) {
    notificationFailure = { error };
  }

  const canReply = threaded.created && threaded.allow_automated_reply !== false &&
    !spam.blocked && !keywordFailure;
  if (frenchStop && canReply && input.receivingNumberActive &&
    !threaded.opted_out && input.carrierResponse !== "STOP") {
    try {
      const confirmation = await sendFrenchOptOutConfirmation(env, {
        companyId,
        from: toE164,
        to: fromE164,
        inboundMessageId: threaded.message_id,
      });
      if (!confirmation.ok) {
        console.warn(`French opt-out confirmation refused for ${threaded.message_id}: ${confirmation.errorCode ?? "unknown"}`);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        console.warn(`French opt-out confirmation refused for ${threaded.message_id}:`, errorLogText(error));
      } else {
        void reportHandledFailure(env, "inbound-french-opt-out-confirmation", error, {
          ids: { messageId: threaded.message_id },
        });
      }
    }
  }
  // After-hours away auto-reply (FEATURE-GAPS Step 1) — only on the first
  // delivery. Best-effort: a failure here (e.g. a not-ready send gate) must
  // NOT wedge the already-durable inbound message in a retry loop, and the
  // guard's per-conversation throttle makes a sweeper replay a no-op anyway.
  // Reply-exempt (D4); opt-out + STOP/HELP honored inside the guard. An
  // emergency is suppressed inside the guard too (#414 ask 4) — it gets the
  // acknowledgment below instead, which promises no human.
  if (canReply && !optOutHint) {
    try {
      await maybeSendAwayReply(env, db, {
        companyId,
        conversationId: threaded.conversation_id,
        fromE164,
        triggerBody: body,
        atUtc: new Date(),
      });
    } catch (error_) {
      void reportHandledFailure(env, "inbound-away-reply", error_, {
        ids: { conversationId: threaded.conversation_id },
      });
    }
  }

  // #481: a departing workspace's customers hear where it went, once each,
  // while we still hold the number. Deliberately AFTER the away reply: an
  // active workspace never reaches this, and a cancelled one has no away reply
  // to send (the gate refuses it), so the two can never both fire. Best-effort
  // and self-swallowing, like the away reply above.
  //
  // Gated on CANCELED specifically, not on "not active". The off-ramp exists
  // for a business that has left, and the grace window it lives inside is
  // measured from `canceled_at` — a past-due workspace has not gone anywhere
  // and has no deadline to be inside. Reading the status off the lookup above
  // rather than fetching it means a paying workspace pays no round trip for a
  // feature that can never fire for it, and an absent status reads as "not a
  // departure" rather than as permission.
  if (carrier && canReply && company?.subscription_status === "canceled") {
    await maybeSendOffRamp(env, db, {
      companyId,
      conversationId: threaded.conversation_id,
      from: toE164,
      to: fromE164,
      triggerBody: body,
    });
  }

  // #414 ask 4: the honest answer. Silence would be better than false
  // reassurance, but it is not the best we can do — someone who did exactly
  // what we told them to deserves to know the word worked, and to be told the
  // numbers that are staffed when ours may not be. The claim also stamps the
  // inbox flag and writes the timeline event, so those can never disagree
  // with whether an emergency happened.
  //
  // Best-effort for the same reason as the away reply, and the same throttle
  // discipline makes a replay a no-op. Note it runs regardless of business
  // hours: an emergency at 2pm with the crew on a roof is still an emergency.
  if (canReply && emergency) {
    try {
      await sendEmergencyAcknowledgment(env, db, {
        companyId,
        conversationId: threaded.conversation_id,
        fromE164,
        triggerBody: body,
        // #460: the owner's own words, already on the company row this handler
        // read. The product's safety line is appended inside, not here.
        ownerMessage: company?.emergency_message ?? null,
        // #228: the language the business works in. Not the contact's here -
        // an emergency reply goes out on the hottest path in the product, and
        // a per-contact read to translate one sentence is not worth a round
        // trip when somebody has just said their heat is out. The safety line
        // inside is translated with it, which is the half that matters.
        companyLocale: company?.locale ?? null,
      });
    } catch (error_) {
      void reportHandledFailure(env, "inbound-emergency-ack", error_, {
        ids: { conversationId: threaded.conversation_id },
      });
    }
  }

  const helpLocale = helpKeywordLocale(body);
  if (carrier && canReply && helpLocale && !input.carrierResponse) {
    try {
      await sendHelpReply(env, db, {
        companyId,
        conversationId: threaded.conversation_id,
        fromE164,
        triggerBody: body,
        locale: helpLocale,
        businessName: company?.name ?? null,
      });
    } catch (error_) {
      void reportHandledFailure(env, "inbound-help-reply", error_, {
        ids: { conversationId: threaded.conversation_id },
      });
    }
  }

  // #39 notification-budget owner alert: the threading RPC meters won §8
  // claims per (company, local day) in the inbound_notification_days ledger and
  // reports each 80%/100% threshold crossing EXACTLY ONCE (stamped under the
  // counter row's lock).
  //
  // #401: PER CHANNEL now, and that is a bug fix rather than a refinement.
  // #343 split the budget in two and this read only `notification_alert`, the
  // legacy scalar the EMAIL ladder alone sets — so a push crossing was stamped
  // in the ledger and announced to nobody. The crew's phones could stop
  // buzzing for new texts with no one told, on exactly the kind of day that
  // makes the year.
  for (const crossing of budgetCrossings(threaded)) {
    try {
      await sendNotificationBudgetAlert(env, db, companyId, crossing, limits);
    } catch (error_) {
      void reportHandledFailure(env, "inbound-notification-budget-alert", error_, {
        ids: { companyId },
      });
    }
  }

  if (keywordFailure) throw keywordFailure.error;
  if (notificationFailure) throw notificationFailure.error;
}

/**
 * #39/#401 owner alert for the daily inbound-notification budget: warn at 80%,
 * state the pause plainly at 100%, **for the channel that crossed**. Operational
 * email to the owner + active admins (bypasses notification_prefs, like every
 * billing/usage alert). The exactly-once guarantee lives in the RPC's ledger
 * stamp — this helper only renders and sends.
 *
 * The copy lives in `notification-budget-alert.ts`, where the reasoning about
 * what a swamped owner needs to read is written down and tested.
 */
async function sendNotificationBudgetAlert(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  crossing: BudgetCrossing,
  limits: { email: number; push: number },
): Promise<void> {
  const { data: companies, error } = await db
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .limit(1);
  if (error) {
    throw new Error(`company name lookup failed: ${error.message}`);
  }
  const name =
    (companies?.[0] as { name: string } | undefined)?.name ?? "Your company";

  const to = await billingRecipients(env, companyId, db, "settings.manage");
  if (to.length === 0) return;

  const copy = budgetAlertCopy({
    companyName: name,
    channel: crossing.channel,
    threshold: crossing.threshold,
    limit: crossing.channel === "email" ? limits.email : limits.push,
    inboxUrl: `${env.APP_ORIGIN}/inbox`,
  });

  await sendEmail(env, {
    to,
    subject: copy.subject,
    text: copy.text,
    html: renderEmailHtml(copy.text),
  });
}

/**
 * §5 opt-out model, app-side: STOP-family writes/updates the opt_outs row
 * (source 'stop_keyword'); START-family revokes. Both write the matching
 * conversation_events row attached to the message's conversation.
 */
async function handleOptOutKeywords(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    body: string;
    wasOptedOut: boolean;
    carrierProfileId?: string | null;
    carrierResponse?: string;
    /**
     * Whether to write the conversation_events timeline entry. The idempotent
     * opt_outs mirror always runs (so a sweeper replay recovers a failed
     * first delivery); the non-idempotent event insert runs only on the first
     * delivery (`threaded.created`) so a replay can't double-log it.
     */
    recordEvent: boolean;
  },
): Promise<boolean> {
  const keyword = normaliseKeyword(args.body);

  if (STOP_KEYWORDS.has(keyword) || isFrenchStopRequest(args.body)) {
    const { error } = await db.from("opt_outs").upsert(
      {
        company_id: args.companyId,
        phone_e164: args.fromE164,
        source: "stop_keyword",
        created_by: null,
        revoked_at: null,
      },
      { onConflict: "company_id,phone_e164" },
    );
    if (error) throw new Error(`opt_outs upsert failed: ${error.message}`);

    if (!args.recordEvent) return true;
    const { error: eventError } = await db.from("conversation_events").insert({
      company_id: args.companyId,
      conversation_id: args.conversationId,
      actor_user_id: null, // system
      type: "opted_out",
      // The customer's exact words, because "Stop." matched only after normalising.
      payload: { source: "stop_keyword", keyword, body: args.body },
    });
    if (eventError) {
      throw new Error(`opted_out event insert failed: ${eventError.message}`);
    }
    await recordAudit(db, {
      companyId: args.companyId,
      actorUserId: null,
      action: "opt_out.recorded",
      targetType: "conversation",
      targetId: args.conversationId,
      after: { source: "stop_keyword" },
    });
    return true;
  }

  if (START_KEYWORDS.has(keyword)) {
    const revokedAt = new Date().toISOString();
    if (keyword === "OUI" && args.carrierResponse !== "START") {
      if (!args.wasOptedOut) return false;
      // A French opt-in can clear a local block once Telnyx confirms delivery is allowed.
      if (!args.carrierProfileId) return true;
      const { optOuts, truncated } = await listCarrierOptOuts(env, args.carrierProfileId, args.fromE164);
      if (truncated || optOuts.some(({ phoneE164 }) => phoneE164 === args.fromE164)) return true;
    }
    // Revoke only an ACTIVE opt-out; a bare "YES" with no opt-out on file is
    // an ordinary message, not an opt-in event.
    let revoke = db
      .from("opt_outs")
      .update({ revoked_at: revokedAt })
      .eq("company_id", args.companyId)
      .eq("phone_e164", args.fromE164)
      .is("revoked_at", null);
    // Preserve an opt-out recorded while the carrier lookup was in flight.
    if (keyword === "OUI") revoke = revoke.lte("updated_at", revokedAt);
    const { data, error } = await revoke.select("id");
    if (error) throw new Error(`opt_outs revoke failed: ${error.message}`);
    // A failed OUI update can mean a newer opt-out won during the carrier lookup.
    if ((data ?? []).length === 0) return keyword === "OUI" && args.wasOptedOut;

    if (!args.recordEvent) return true;
    const { error: eventError } = await db.from("conversation_events").insert({
      company_id: args.companyId,
      conversation_id: args.conversationId,
      actor_user_id: null,
      type: "opt_out_revoked",
      payload: { source: "start_keyword", keyword },
    });
    if (eventError) {
      throw new Error(
        `opt_out_revoked event insert failed: ${eventError.message}`,
      );
    }
    await recordAudit(db, {
      companyId: args.companyId,
      actorUserId: null,
      action: "opt_out.revoked",
      targetType: "conversation",
      targetId: args.conversationId,
      after: { source: "start_keyword" },
    });
    return true;
  }

  return false;
}

/**
 * Inbound MMS media (SPEC §7, D30): fetch each Telnyx media URL immediately
 * (they expire after ~30 days but we never wait), validate content-type and
 * size (≤5 MB, the bucket limit), store to
 * mms-media/{company_id}/{message_id}/{n}, and insert message_attachments
 * with source_url = the Telnyx URL — the (message_id, source_url) unique
 * makes redownloads idempotent. At most the first MAX_INBOUND_MEDIA_ITEMS
 * (10) items are processed per message (D30); the tail is skipped with a
 * warning, the same permanent-condition outcome as an unsupported type.
 */


/**
 * Why a customer's file did not make it into the thread (#317).
 *
 * Every one of these was a `console.warn` and nothing else, so the file simply
 * vanished and the crew had no way to know it had ever existed — they see a
 * message with no picture and assume the customer forgot to attach it. #317 asks
 * for the opposite posture in as many words: "not silently delivered and not
 * silently dropped".
 */
export type MediaRefusalReason =
  /** A type carriers relay but we cannot serve (the bucket would reject it). */
  | "unsupported_type"
  /** Over MAX_INBOUND_MEDIA_BYTES — the bucket's own ceiling. */
  | "too_large"
  /** Zero bytes arrived. Nothing to store and nothing to show. */
  | "empty"
  /**
   * The bytes are not what the carrier declared them to be — a renamed
   * executable arriving as image/jpeg is the case that matters. The uploaded-
   * attachment route has checked this since D19; this path, the one #317 calls
   * "uncontrolled", trusted the declaration.
   */
  | "type_mismatch"
  /** Past the D30 per-message item cap. The message came with too many files. */
  | "too_many_items"
  /**
   * #317: the file IS the type it claims, and that type is allowed, and what is
   * inside it is dangerous — a macro project, an embedded program, a PDF that
   * launches something when opened. The type checks above cannot see any of
   * that, because none of it is the wrong type.
   *
   * The specific finding rides in the payload as `scan_reason` for metrics and
   * for whoever is reading logs; the crew gets one line and one action, because
   * the difference between a VBA project and a /Launch action changes nothing
   * they can do about it.
   */
  | "unsafe_content"
  /**
   * #317: we could not read inside the file to check it — a corrupt container,
   * a Zip64 archive, something past the scan ceiling. Held rather than passed
   * on, because "we did not look" is not a reason to hand somebody a file.
   */
  | "unreadable"
  | "download_failed";

interface InboundMediaOwner {
  companyId: string;
  conversationId: string | null;
  messageId: string;
}

interface InboundMediaItem {
  url: string;
  content_type?: string;
}

type MediaDownload =
  | { bytes: ArrayBuffer; contentType: string }
  | { reason: MediaRefusalReason; contentType?: string; sizeBytes?: number };

async function recordMediaRefusal(
  db: SupabaseClient,
  args: InboundMediaOwner & {
    index: number;
    reason: MediaRefusalReason;
    contentType?: string | null;
    sizeBytes?: number | null;
    /** #317: the structural finding, for operators. Never shown to the crew. */
    scanReason?: string | null;
  },
): Promise<void> {
  console.warn(
    `inbound media ${args.index} for message ${args.messageId} refused (${args.reason})`,
  );
  if (!args.conversationId) return;
  const event: ConversationEventRow = {
    company_id: args.companyId,
    conversation_id: args.conversationId,
    actor_user_id: null,
    type: "media_refused",
    payload: {
      reason: args.reason,
      message_id: args.messageId,
      index: args.index,
      content_type: args.contentType ?? null,
      size_bytes: args.sizeBytes ?? null,
      scan_reason: args.scanReason ?? null,
    },
  };
  const { error } = await db.from("conversation_events").insert([event]);
  if (error && error.code !== "23505") {
    const message = `media refusal write failed for message ${args.messageId}: ${error.message}`;
    if (args.reason === "download_failed") throw new Error(message);
    console.warn(message);
  }
}

async function downloadInboundMedia(
  db: SupabaseClient,
  args: InboundMediaOwner & { media: InboundMediaItem[] },
): Promise<void> {
  const items = args.media.slice(0, MAX_INBOUND_MEDIA_ITEMS);

  // Skip items already stored (idempotent replay).
  const { data: existing, error: existingError } = await db
    .from("message_attachments")
    .select("source_url")
    .eq("message_id", args.messageId)
    .not("source_url", "is", null);
  if (existingError) {
    throw new Error(`attachments lookup failed: ${existingError.message}`);
  }
  const stored = new Set(
    ((existing ?? []) as { source_url: string | null }[]).map(
      (row) => row.source_url,
    ),
  );

  let failure: Error | null = null;
  for (const [index, item] of items.entries()) {
    if (stored.has(item.url)) continue;
    try {
      await storeInboundMediaItem(db, args, index, item);
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (args.media.length > MAX_INBOUND_MEDIA_ITEMS) {
    await recordMediaRefusal(db, {
      ...args,
      index: MAX_INBOUND_MEDIA_ITEMS,
      reason: "too_many_items",
    });
  }
  if (failure) throw failure;
}

async function fetchInboundMedia(item: InboundMediaItem, messageId: string): Promise<MediaDownload> {
  const download = deadline(INBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(item.url, { signal: download.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const { status } = response;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        return { reason: "download_failed" };
      }
      throw new Error(`media download failed (HTTP ${status}) for message ${messageId}`);
    }
    const contentType = canonicalMmsType(
      response.headers.get("content-type")?.split(";")[0]?.trim() || item.content_type || "",
    );
    if (!(INBOUND_MEDIA_TYPES as readonly string[]).includes(contentType)) {
      void response.body?.cancel().catch(() => {});
      return { reason: "unsupported_type", contentType };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_INBOUND_MEDIA_BYTES) {
      void response.body?.cancel().catch(() => {});
      return { reason: "too_large", contentType, sizeBytes: declaredLength };
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_MEDIA_BYTES) {
      return {
        reason: bytes.byteLength === 0 ? "empty" : "too_large",
        contentType,
        sizeBytes: bytes.byteLength,
      };
    }
    return { bytes, contentType };
  } finally {
    download.clear();
  }
}

async function storeInboundMediaItem(
  db: SupabaseClient,
  args: InboundMediaOwner,
  index: number,
  item: InboundMediaItem,
): Promise<void> {
  const download = await fetchInboundMedia(item, args.messageId);
  if ("reason" in download) {
    await recordMediaRefusal(db, { ...args, index, ...download });
    return;
  }
  const { bytes, contentType } = download;
  const file = new Uint8Array(bytes);
  const details = { ...args, index, contentType, sizeBytes: bytes.byteLength };

  if (!bytesMatchDeclaredType(file, contentType)) {
    await recordMediaRefusal(db, { ...details, reason: "type_mismatch" });
    return;
  }

  const scan = scanAttachment(file, contentType);
  if (scan.verdict !== "clean") {
    await recordMediaRefusal(db, {
      ...details,
      reason: scan.verdict === "blocked" ? "unsafe_content" : "unreadable",
      scanReason: scan.reason,
    });
    return;
  }

  stripImageLocation(file, contentType);

  const path = mediaStoragePath(args.companyId, args.messageId, index);
  const upload = await db.storage.from(MMS_BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (upload.error) {
    throw new Error(`media store failed (${path}): ${upload.error.message}`);
  }

  const { error } = await db.from("message_attachments").insert({
    message_id: args.messageId,
    company_id: args.companyId,
    storage_path: path,
    content_type: contentType,
    size_bytes: bytes.byteLength,
    source_url: item.url,
  });
  // A concurrent replay can insert the attachment first.
  if (error && error.code !== "23505") {
    throw new Error(`message_attachments insert failed: ${error.message}`);
  }
}
