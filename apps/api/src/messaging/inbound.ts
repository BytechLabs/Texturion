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
import { canonicalMmsType } from "@loonext/shared";

import { PLAN_NOTIFY_LIMITS, type PlanId } from "../billing/plans";
import { billingRecipients } from "../billing/recipients";
import { looksLikeOptOut } from "@loonext/shared";

import { capture } from "../analytics/posthog";
import { recordAudit } from "../audit/log";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { notifyInboundMessage } from "../notifications/inbound";
import { classifyInbound } from "./spam-flag";
import { scanAttachment } from "../attachments/scan";
import { bytesMatchDeclaredType } from "../routes/core/attachments";
import { insertConversationEvents } from "../routes/core/events";
import { maybeSendAwayReply } from "./away-reply";
import { maybeSendOffRamp } from "./off-ramp";
import { sendEmergencyAcknowledgment } from "./emergency-ack";
import {
  budgetAlertCopy,
  budgetCrossings,
  type BudgetCrossing,
} from "./notification-budget-alert";
import {
  effectiveEmergencyKeywords,
  isEmergencyKeyword,
  START_KEYWORDS,
  STOP_KEYWORDS,
} from "./keywords";
import {
  INBOUND_MEDIA_TYPES,
  MAX_INBOUND_MEDIA_BYTES,
  MAX_INBOUND_MEDIA_ITEMS,
  MMS_BUCKET,
  mediaStoragePath,
} from "./media";
import type { TelnyxEvent, ThreadResult } from "./types";

/**
 * The threading RPC's return with the #39 additive key: `notification_alert`
 * is 80/100 exactly once per (company, UTC day) when this claim crossed that
 * percentage of the daily inbound-notification allowance, else null/absent.
 */
type InboundThreadResult = ThreadResult & {
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
  notify_reason?: "new" | "reopened" | "append";
};

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
  if (!env.POSTHOG_API_KEY) return; // analytics off — keep the hot path clean
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
    await capture(env, "first_inbound_reply", args.companyId, {
      country: args.country ?? "unknown",
      us_texting_enabled: args.usTextingEnabled === true,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error("first_inbound_reply capture skipped:", detail);
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
    .select(
      "id,company_id," +
        "companies(timezone,plan,notify_email_limit,notify_push_limit," +
        // #281: first_inbound_reply_at is the activation ledger, and
        // country/us_texting_enabled segment the funnel (#369 asks for
        // Canada-only and US-enabled reported apart, because they have
        // structurally different time-to-value). All three ride the lookup this
        // path already makes, so activation costs no extra round trip either.
        "emergency_keyword_enabled,emergency_keywords,emergency_message," +
        "first_inbound_reply_at,country,us_texting_enabled," +
        // #481: the off-ramp only ever applies to a workspace on its way
        // out, and this is the hottest path in the product. Riding the
        // lookup that already runs means a PAYING workspace costs nothing
        // for a feature it can never use — the alternative was a second
        // round trip on every inbound message forever.
        "subscription_status)",
    )
    .eq("number_e164", toE164)
    .neq("status", "released")
    .limit(1);
  if (numberError) {
    throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
  }
  const number = (numbers ?? [])[0] as unknown as
    | {
        id: string;
        company_id: string;
        companies?: {
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
          subscription_status?: string | null;
        } | null;
      }
    | undefined;
  if (!number) {
    console.warn(`message.received for unknown number — ignored`);
    return;
  }

  // #343: the ceilings, per plan, with an ops-only per-company override on
  // top. They live in TypeScript beside every other plan number rather than in
  // a second SQL CASE — that is how 500/2500 ended up in three places — and
  // are passed in, so raising one for a customer who needs it is a column
  // write rather than a migration and a deploy.
  const company = number.companies ?? null;
  const planLimits =
    PLAN_NOTIFY_LIMITS[(company?.plan ?? "starter") as PlanId] ??
    PLAN_NOTIFY_LIMITS.starter;

  // The §6 threading transaction, atomically in the database.
  const { data, error } = await db.rpc("thread_inbound_message", {
    p_company_id: number.company_id,
    p_phone_number_id: number.id,
    p_from_e164: fromE164,
    p_body: payload.text ?? "",
    p_telnyx_message_id: telnyxMessageId,
    p_timezone: company?.timezone ?? null,
    p_email_limit: company?.notify_email_limit ?? planLimits.email,
    p_push_limit: company?.notify_push_limit ?? planLimits.push,
  });
  if (error) throw new Error(`thread_inbound_message failed: ${error.message}`);
  const threaded = data as InboundThreadResult | null;
  if (!threaded?.message_id || !threaded.conversation_id) {
    throw new Error("thread_inbound_message returned no message");
  }

  // #281 activation: the reply half of D12, once per workspace. Gated on the
  // first delivery so a §11 sweeper replay cannot re-emit it, and awaited
  // because it never rejects.
  if (threaded.created) {
    await captureFirstInboundReply(env, db, {
      companyId: number.company_id,
      conversationId: threaded.conversation_id,
      messageId: threaded.message_id,
      alreadyStampedAt: company?.first_inbound_reply_at,
      country: company?.country,
      usTextingEnabled: company?.us_texting_enabled,
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
  await handleOptOutKeywords(db, {
    companyId: number.company_id,
    conversationId: threaded.conversation_id,
    fromE164,
    body: payload.text ?? "",
    recordEvent: threaded.created,
  });

  // #414: the reply we asked for. The default away message — on by default,
  // kept by most owners — invites an emergency reply, and until now that reply
  // threaded as an ordinary message.
  //
  // #460: matched against THIS workspace's words. A null column means the
  // product list, so nothing changes for a workspace that never opened the
  // setting — but a locksmith whose customers text LOCKEDOUT is now heard, and
  // the settings screen warns against the same list this line acts on.
  const emergency =
    (company?.emergency_keyword_enabled ?? true) &&
    isEmergencyKeyword(
      payload.text ?? "",
      effectiveEmergencyKeywords(company?.emergency_keywords),
    );

  // #250: does this look like a robotext, or did somebody block this sender?
  // Runs before the notification decision below and after the message is
  // durable, so a classifier failure can only cost a badge.
  const spam = threaded.created
    ? await classifyInbound(db, {
        companyId: number.company_id,
        conversationId: threaded.conversation_id,
        fromE164,
        body: payload.text,
      })
    : { blocked: false, suspected: false };

  // #396: a plain-English opt-out is legally binding and only the KEYWORD was
  // ever detected. "Please stop texting me" is not an exact STOP, so Telnyx
  // does not block it, `stop_keyword` never fires, and no 40300 is produced for
  // the carrier reconciliation to find. It lands as ordinary text.
  //
  // This FLAGS the thread and does not opt anyone out — deliberately. An
  // opt-out cannot be lifted by us (#331): only the contact texting START
  // clears it, so a false positive would permanently silence a paying
  // customer's real lead with no way back for either of them. Warn loudly, let
  // a human decide.
  //
  // Best-effort: the inbound message is already durable, and a failure to raise
  // a WARNING must never wedge it in a retry loop.
  if (looksLikeOptOut(payload.text)) {
    try {
      await db
        .from("conversations")
        .update({ opt_out_hint_at: new Date().toISOString() })
        .eq("id", threaded.conversation_id)
        .eq("company_id", number.company_id);
      // #345/D22: "we were told, and we knew" is the fact that matters if this
      // is ever disputed. The actor is the CONTACT, not a member.
      await recordAudit(db, {
        companyId: number.company_id,
        actorUserId: null,
        action: "opt_out.language_detected",
        targetType: "conversation",
        targetId: threaded.conversation_id,
        after: { from: fromE164 },
      });
    } catch (cause) {
      console.error(
        `opt-out language flag for conversation ${threaded.conversation_id} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  // After-hours away auto-reply (FEATURE-GAPS Step 1) — only on the first
  // delivery. Best-effort: a failure here (e.g. a not-ready send gate) must
  // NOT wedge the already-durable inbound message in a retry loop, and the
  // guard's per-conversation throttle makes a sweeper replay a no-op anyway.
  // Reply-exempt (D4); opt-out + STOP/HELP honored inside the guard. An
  // emergency is suppressed inside the guard too (#414 ask 4) — it gets the
  // acknowledgment below instead, which promises no human.
  if (threaded.created) {
    try {
      await maybeSendAwayReply(env, db, {
        companyId: number.company_id,
        conversationId: threaded.conversation_id,
        fromE164,
        triggerBody: payload.text ?? "",
        atUtc: new Date(),
      });
    } catch (cause) {
      console.error(
        `away-reply for conversation ${threaded.conversation_id} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
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
  if (threaded.created && company?.subscription_status === "canceled") {
    await maybeSendOffRamp(env, db, {
      companyId: number.company_id,
      conversationId: threaded.conversation_id,
      from: toE164,
      to: fromE164,
      triggerBody: payload.text ?? "",
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
  if (threaded.created && emergency) {
    try {
      await sendEmergencyAcknowledgment(env, db, {
        companyId: number.company_id,
        conversationId: threaded.conversation_id,
        fromE164,
        triggerBody: payload.text ?? "",
        // #460: the owner's own words, already on the company row this handler
        // read. The product's safety line is appended inside, not here.
        ownerMessage: company?.emergency_message ?? null,
      });
    } catch (cause) {
      console.error(
        `emergency acknowledgment for conversation ${threaded.conversation_id} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  // MMS media list (needed for `mediaCount` in the notification below). The
  // actual download runs LAST — see the note at the end of the handler.
  const media = (payload.media ?? []).filter(
    (item): item is { url: string; content_type?: string; size?: number } =>
      typeof item.url === "string" && item.url.length > 0,
  );

  // #39 notification-budget owner alert: the threading RPC meters won §8
  // claims per (company, local day) in the inbound_notification_days ledger and
  // reports each 80%/100% threshold crossing EXACTLY ONCE (stamped under the
  // counter row's lock), so this send can never duplicate — the same
  // ledger-first shape as the usage-alerts emails. Sent BEFORE the member
  // fan-out so a notify failure can never eat the one-shot alert.
  //
  // #401: PER CHANNEL now, and that is a bug fix rather than a refinement.
  // #343 split the budget in two and this read only `notification_alert`, the
  // legacy scalar the EMAIL ladder alone sets — so a push crossing was stamped
  // in the ledger and announced to nobody. The crew's phones could stop
  // buzzing for new texts with no one told, on exactly the kind of day that
  // makes the year.
  for (const crossing of budgetCrossings(threaded)) {
    // Swallow a send failure (like the away-reply block above): the alert is
    // ledger-stamped once and unrecoverable on replay, so a Resend outage here
    // must NOT abort the handler before the create-gated customer notification
    // below — otherwise the actual new-message alert is dropped forever.
    try {
      await sendNotificationBudgetAlert(env, db, number.company_id, crossing, {
        email: company?.notify_email_limit ?? planLimits.email,
        push: company?.notify_push_limit ?? planLimits.push,
      });
    } catch (cause) {
      console.error(
        `notification-budget alert for company ${number.company_id} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  // Notification pipeline (§8). Runs BEFORE the MMS media download below: the
  // download deliberately throws on a transient CDN failure to trigger a §11
  // sweeper replay, and the replay hits the thread-dedup fast-path
  // (created=false) — so if a media throw aborted the handler here, this
  // create-gated notify would be skipped FOREVER and the customer's text would
  // silently produce no alert. The RPC decided the debounced trigger and
  // stamped last_notified_at atomically; `notify` is true at most once per
  // claim, so duplicates and sweeper replays never re-send. Past the #39 daily
  // budget the RPC reports notify=false (cap-and-drop).
  //
  // #343: `notify` is the EMAIL verdict now, so the trigger asks about either
  // channel. A workspace past its email ceiling but under its push one still
  // gets notified — push is free at both ends, and silencing it because a
  // Resend bill ran out was never the intent.
  const allowEmail = threaded.notify_email ?? threaded.notify === true;
  const allowPush = threaded.notify_push ?? threaded.notify === true;

  // #414: an emergency bypasses BOTH gates above, each for its own reason:
  //
  //   the 15-minute debounce — a customer who texted two minutes ago and then
  //   types URGENT is the exact case the debounce would silence, and it is the
  //   one case that must never be silent.
  //
  //   the #343 daily budget — a cost ceiling dropping a no-heat call in
  //   January is not a trade-off anybody would choose. An emergency is not
  //   metered.
  // #250: an emergency keyword still bypasses everything, deliberately. A
  // customer typing URGENT is the one case that must never be silent, and a
  // classifier is not confident enough to overrule it — the whole posture here
  // is that the machine badges and never decides.
  if (threaded.created && !emergency && spam.suspected) {
    console.log(
      `inbound spam suspected on conversation ${threaded.conversation_id}: ` +
        `notification suppressed, thread left in the inbox`,
    );
  }
  const spamSilences = !emergency && (spam.suspected || spam.blocked);

  if (threaded.created && !spamSilences && (emergency || allowEmail || allowPush)) {
    await notifyInboundMessage(
      env,
      {
        companyId: number.company_id,
        conversationId: threaded.conversation_id,
        body: payload.text ?? "",
        mediaCount: media.length,
        // An emergency reaches every channel it can, whatever the budget says.
        allowEmail: emergency || allowEmail,
        allowPush: emergency || allowPush,
        emergency,
        // #391: a first inbound on a new or reopened thread is a lead.
        lead:
          threaded.notify_reason === "new" ||
          threaded.notify_reason === "reopened",
      },
      db,
    );
  }

  // MMS media download runs LAST — idempotent (existing attachment rows are
  // skipped) and it THROWS on a transient CDN failure so the §11 sweeper
  // replays just this step. Because it's after the one-shot notification above,
  // a media-CDN hiccup can no longer eat the new-message alert.
  if (media.length > 0) {
    await downloadInboundMedia(db, {
      companyId: number.company_id,
      conversationId: threaded.conversation_id,
      messageId: threaded.message_id,
      media,
    });
  }
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

  const to = await billingRecipients(env, companyId, db);
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
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    body: string;
    /**
     * Whether to write the conversation_events timeline entry. The idempotent
     * opt_outs mirror always runs (so a sweeper replay recovers a failed
     * first delivery); the non-idempotent event insert runs only on the first
     * delivery (`threaded.created`) so a replay can't double-log it.
     */
    recordEvent: boolean;
  },
): Promise<void> {
  const keyword = args.body.trim().toUpperCase();

  if (STOP_KEYWORDS.has(keyword)) {
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

    if (!args.recordEvent) return;
    const { error: eventError } = await db.from("conversation_events").insert({
      company_id: args.companyId,
      conversation_id: args.conversationId,
      actor_user_id: null, // system
      type: "opted_out",
      payload: { source: "stop_keyword", keyword },
    });
    if (eventError) {
      throw new Error(`opted_out event insert failed: ${eventError.message}`);
    }
    return;
  }

  if (START_KEYWORDS.has(keyword)) {
    // Revoke only an ACTIVE opt-out; a bare "YES" with no opt-out on file is
    // an ordinary message, not an opt-in event.
    const { data, error } = await db
      .from("opt_outs")
      .update({ revoked_at: new Date().toISOString() })
      .eq("company_id", args.companyId)
      .eq("phone_e164", args.fromE164)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new Error(`opt_outs revoke failed: ${error.message}`);
    if ((data ?? []).length === 0) return;

    if (!args.recordEvent) return;
    const { error: eventError } = await db.from("conversation_events").insert({
      company_id: args.companyId,
      conversation_id: args.conversationId,
      actor_user_id: null,
      type: "opt_out_revoked",
      payload: { source: "stop_keyword", keyword },
    });
    if (eventError) {
      throw new Error(
        `opt_out_revoked event insert failed: ${eventError.message}`,
      );
    }
  }
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
  | "unreadable";

/**
 * Record a refusal where the crew will actually see it.
 *
 * Best-effort by construction. This runs inside the inbound pipeline, and a
 * failure to write the EXPLANATION must never fail delivery of the message the
 * explanation is about — the customer's text matters more than our note about
 * their attachment. The console line stays for the same reason the event was
 * added: two records of a refusal are cheap, and one of them survives a database
 * that has not been migrated yet.
 */
async function recordMediaRefusal(
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string | null;
    messageId: string;
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
  try {
    await insertConversationEvents(db, [
      {
        company_id: args.companyId,
        conversation_id: args.conversationId,
        // Nobody on the crew did this, and the sender is not a user. A null
        // actor is what the timeline already uses for events the system
        // originates.
        actor_user_id: null,
        type: "media_refused",
        payload: {
          reason: args.reason,
          message_id: args.messageId,
          index: args.index,
          // Deliberately NOT the file name or the source URL: the name is
          // attacker-controlled text that would render in the thread, and the
          // URL is a live handle to bytes we just declined to store.
          content_type: args.contentType ?? null,
          size_bytes: args.sizeBytes ?? null,
          // #317: `zip_macro`, `pdf_launch`, … — our own finding, not anything
          // the sender chose, so it is safe to render and useful to search on.
          scan_reason: args.scanReason ?? null,
        },
      },
    ]);
  } catch (cause) {
    console.warn(
      `media_refused event write failed for message ${args.messageId}: ${String(cause)}`,
    );
  }
}

async function downloadInboundMedia(
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string | null;
    messageId: string;
    media: { url: string; content_type?: string; size?: number }[];
  },
): Promise<void> {
  // #121: storage is free — inbound media is ALWAYS saved (the old #12
  // cap-and-drop is gone). Cost exposure is handled by the usage-alerts
  // cron's storage-abuse arm (customer + ops email at absolute tiers), a
  // human follow-up instead of silently dropping a customer's pictures.
  // D30 per-message item cap: process the first 10, skip the rest. Skipping
  // (not throwing) keeps the ledger row processable — retrying would never
  // change how many items the sender attached.
  if (args.media.length > MAX_INBOUND_MEDIA_ITEMS) {
    await recordMediaRefusal(db, {
      companyId: args.companyId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      index: MAX_INBOUND_MEDIA_ITEMS,
      reason: "too_many_items",
    });
  }
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

  for (const [index, item] of items.entries()) {
    if (stored.has(item.url)) continue;

    const response = await fetch(item.url);
    if (!response.ok) {
      // Transient CDN failure: throw so the ledger row stays unprocessed and
      // the §11 sweeper retries the whole (idempotent) pipeline.
      throw new Error(
        `media download failed (HTTP ${response.status}) for message ${args.messageId}`,
      );
    }
    // #189: canonicalize vendor spellings (audio/x-wav, audio/amr-nb, …) so
    // deliverable media isn't dropped over a MIME synonym; the canonical type
    // is also what gets stored (the bucket's allowed_mime_types match it).
    const contentType = canonicalMmsType(
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
        item.content_type ||
        "",
    );
    if (!(INBOUND_MEDIA_TYPES as readonly string[]).includes(contentType)) {
      // Permanent condition (a type carriers relayed but we can't serve):
      // skipping is the §7 validation outcome — retrying would never change it.
      await recordMediaRefusal(db, {
        companyId: args.companyId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        reason: "unsupported_type",
        contentType,
      });
      continue;
    }
    // Reject obviously-oversized media BEFORE reading it into Worker memory: a
    // carrier relaying a huge file would otherwise be fully buffered into RAM
    // only to be discarded. Content-Length can be absent or wrong, so the
    // post-read byteLength check below stays the authoritative guard.
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_INBOUND_MEDIA_BYTES
    ) {
      await recordMediaRefusal(db, {
        companyId: args.companyId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        reason: "too_large",
        contentType,
        sizeBytes: declaredLength,
      });
      continue;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_MEDIA_BYTES) {
      await recordMediaRefusal(db, {
        companyId: args.companyId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        reason: bytes.byteLength === 0 ? "empty" : "too_large",
        contentType,
        sizeBytes: bytes.byteLength,
      });
      continue;
    }

    // #317 — the bytes have to BE what the carrier said they are.
    //
    // The uploaded-attachment route has re-derived the type from the leading
    // bytes since D19 ("never trusting the client-declared type"). This path did
    // not, and it is the one the issue calls uncontrolled: anyone who knows the
    // number can send us a file, no signup and no relationship required, and the
    // declaration comes from a carrier CDN relaying whatever the sender's phone
    // claimed.
    //
    // `bytesMatchDeclaredType` refuses a KNOWN executable signature whatever it
    // claims to be, and refuses bytes that sniff to a different concrete media
    // class than the declaration. It deliberately ACCEPTS bytes with no
    // distinctive magic, which is most audio and video — dropping a customer's
    // voice note because we have no signature for AMR would be the silent-drop
    // failure this whole change is about.
    if (!bytesMatchDeclaredType(new Uint8Array(bytes), contentType)) {
      await recordMediaRefusal(db, {
        companyId: args.companyId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        reason: "type_mismatch",
        contentType,
        sizeBytes: bytes.byteLength,
      });
      continue;
    }

    // #317 — the bytes are the type they claim, the type is allowed, and NOW
    // we look at what is inside.
    //
    // Everything above stops the wrong file TYPE. It cannot stop a malicious
    // file of an allowed one, and the allow-list includes the two formats that
    // carry payloads: PDF, and the OpenXML/ODF family, which are ZIP
    // containers. This is the path the issue calls uncontrolled — anyone who
    // knows a number printed on a truck can send it a file — and we are the
    // ones who store it, sign a URL for it, and put it on a tech's phone.
    //
    // Refused BEFORE the upload, so a blocked file never becomes an object at
    // all. The event below is what stops that being a silent drop.
    const scan = scanAttachment(new Uint8Array(bytes), contentType);
    if (scan.verdict !== "clean") {
      await recordMediaRefusal(db, {
        companyId: args.companyId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        reason: scan.verdict === "blocked" ? "unsafe_content" : "unreadable",
        contentType,
        sizeBytes: bytes.byteLength,
        scanReason: scan.reason,
      });
      continue;
    }

    const path = mediaStoragePath(args.companyId, args.messageId, index);
    const upload = await db.storage.from(MMS_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true, // replays re-write the same object
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
    // A concurrent replay may have inserted the row between our lookup and
    // now — the (message_id, source_url) unique makes that a benign conflict.
    if (error && error.code !== "23505") {
      throw new Error(`message_attachments insert failed: ${error.message}`);
    }
  }
}
