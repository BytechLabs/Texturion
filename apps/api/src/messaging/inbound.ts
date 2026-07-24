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

import { billingRecipients } from "../billing/recipients";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { notifyInboundMessage } from "../notifications/inbound";
import { maybeSendAwayReply } from "./away-reply";
import { START_KEYWORDS, STOP_KEYWORDS } from "./keywords";
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
};

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
    .select("id,company_id")
    .eq("number_e164", toE164)
    .neq("status", "released")
    .limit(1);
  if (numberError) {
    throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
  }
  const number = (numbers ?? [])[0] as
    | { id: string; company_id: string }
    | undefined;
  if (!number) {
    console.warn(`message.received for unknown number — ignored`);
    return;
  }

  // The §6 threading transaction, atomically in the database.
  const { data, error } = await db.rpc("thread_inbound_message", {
    p_company_id: number.company_id,
    p_phone_number_id: number.id,
    p_from_e164: fromE164,
    p_body: payload.text ?? "",
    p_telnyx_message_id: telnyxMessageId,
  });
  if (error) throw new Error(`thread_inbound_message failed: ${error.message}`);
  const threaded = data as InboundThreadResult | null;
  if (!threaded?.message_id || !threaded.conversation_id) {
    throw new Error("thread_inbound_message returned no message");
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

  // After-hours away auto-reply (FEATURE-GAPS Step 1) — only on the first
  // delivery. Best-effort: a failure here (e.g. a not-ready send gate) must
  // NOT wedge the already-durable inbound message in a retry loop, and the
  // guard's per-conversation throttle makes a sweeper replay a no-op anyway.
  // Reply-exempt (D4); opt-out + STOP/HELP honored inside the guard.
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

  // MMS media list (needed for `mediaCount` in the notification below). The
  // actual download runs LAST — see the note at the end of the handler.
  const media = (payload.media ?? []).filter(
    (item): item is { url: string; content_type?: string; size?: number } =>
      typeof item.url === "string" && item.url.length > 0,
  );

  // #39 notification-budget owner alert: the threading RPC meters won §8
  // claims per (company, UTC day) in the inbound_notification_days ledger and
  // reports each 80%/100% threshold crossing EXACTLY ONCE (stamped under the
  // counter row's lock), so this send can never duplicate — the same
  // ledger-first shape as the usage-alerts emails. Sent BEFORE the member
  // fan-out so a notify failure can never eat the one-shot alert.
  if (
    threaded.notification_alert === 80 ||
    threaded.notification_alert === 100
  ) {
    await sendNotificationBudgetAlert(
      env,
      db,
      number.company_id,
      threaded.notification_alert,
    );
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
  if (threaded.created && threaded.notify === true) {
    await notifyInboundMessage(
      env,
      {
        companyId: number.company_id,
        conversationId: threaded.conversation_id,
        body: payload.text ?? "",
        mediaCount: media.length,
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
      messageId: threaded.message_id,
      media,
    });
  }
}

/**
 * #39 owner alert for the daily inbound-notification budget: warn at 80%,
 * state the drop plainly at 100%. Operational email to the owner + active
 * admins (bypasses notification_prefs, like every billing/usage alert). The
 * exactly-once guarantee lives in the RPC's ledger stamp — this helper only
 * renders and sends.
 */
async function sendNotificationBudgetAlert(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  threshold: 80 | 100,
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

  const inboxUrl = `${env.APP_ORIGIN}/inbox`;
  const copy =
    threshold === 100
      ? {
          subject: `${name} has reached today's new-text alert limit`,
          text:
            `Hi,\n\n${name}'s team has been alerted about an unusually large ` +
            `number of new text conversations today and has reached the daily ` +
            `limit on new-text alerts. Email and push alerts for new texts are ` +
            `paused until tomorrow so a message flood can't run up costs. ` +
            `Every text still lands in your Loonext inbox as normal.\n\n` +
            `Open your inbox: ${inboxUrl}\n\nLoonext`,
        }
      : {
          subject: `${name} is nearing today's new-text alert limit`,
          text:
            `Hi,\n\n${name}'s team has been alerted about an unusually large ` +
            `number of new text conversations today. If this keeps up, email ` +
            `and push alerts for new texts will pause until tomorrow (every ` +
            `text still lands in your Loonext inbox as normal). If you aren't ` +
            `expecting this volume, check your inbox for spam threads.\n\n` +
            `Open your inbox: ${inboxUrl}\n\nLoonext`,
        };

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


async function downloadInboundMedia(
  db: SupabaseClient,
  args: {
    companyId: string;
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
    console.warn(
      `inbound message ${args.messageId} carries ${args.media.length} media items — processing the first ${MAX_INBOUND_MEDIA_ITEMS}, skipping the rest (D30)`,
    );
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
      console.warn(
        `inbound media ${index} for message ${args.messageId} has unsupported type — skipped`,
      );
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
      console.warn(
        `inbound media ${index} for message ${args.messageId} declares ${declaredLength} bytes (over ${MAX_INBOUND_MEDIA_BYTES}) — skipped without buffering`,
      );
      continue;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_MEDIA_BYTES) {
      console.warn(
        `inbound media ${index} for message ${args.messageId} is empty or over ${MAX_INBOUND_MEDIA_BYTES} bytes — skipped`,
      );
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
