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

import { STORAGE_BUDGET_BYTES, type PlanId } from "../billing/plans";
import { getDb } from "../db";
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
  const threaded = data as ThreadResult | null;
  if (!threaded?.message_id || !threaded.conversation_id) {
    throw new Error("thread_inbound_message returned no message");
  }

  // Opt-out keyword handling — only on the first delivery of this message
  // (duplicate webhooks must not double-write events).
  if (threaded.created) {
    await handleOptOutKeywords(db, {
      companyId: number.company_id,
      conversationId: threaded.conversation_id,
      fromE164,
      body: payload.text ?? "",
    });
  }

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

  // MMS media — always attempted (idempotent: existing attachment rows are
  // skipped) so a sweeper replay after a download failure completes the set.
  const media = (payload.media ?? []).filter(
    (item): item is { url: string; content_type?: string; size?: number } =>
      typeof item.url === "string" && item.url.length > 0,
  );
  if (media.length > 0) {
    await downloadInboundMedia(db, {
      companyId: number.company_id,
      messageId: threaded.message_id,
      media,
    });
  }

  // Notification pipeline (§8), last per the §7 dispatch order. The RPC
  // decided the debounced trigger and stamped last_notified_at atomically;
  // `notify` is true at most once per claim, so duplicates and sweeper
  // replays never re-send.
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
 * #12 cap-and-drop: is the company at or over its plan storage budget (D30
 * attachments + MMS media, both arms via api_storage_usage)? Pre-checkout / an
 * unknown plan returns false (no budget yet, and they can't own much). Used to
 * DROP new inbound media instead of growing storage unbounded on our dollar.
 */
async function companyOverStorageBudget(
  db: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  const { data: companies, error: companyError } = await db
    .from("companies")
    .select("plan")
    .eq("id", companyId)
    .limit(1);
  const plan = (companies?.[0] as { plan: PlanId | null } | undefined)?.plan;
  if (companyError || !plan) return false;

  const { data: usage, error: usageError } = await db.rpc("api_storage_usage", {
    p_company_id: companyId,
  });
  if (usageError) {
    throw new Error(`storage usage lookup failed: ${usageError.message}`);
  }
  const u = usage as {
    attachments_bytes: number | string;
    mms_bytes: number | string;
  };
  const total = Number(u.attachments_bytes) + Number(u.mms_bytes);
  return total >= STORAGE_BUDGET_BYTES[plan];
}

async function downloadInboundMedia(
  db: SupabaseClient,
  args: {
    companyId: string;
    messageId: string;
    media: { url: string; content_type?: string; size?: number }[];
  },
): Promise<void> {
  // #12 cap-and-drop: over the storage budget → DROP this message's media (the
  // text already arrived; we never grow storage unbounded on our dollar). The
  // owner is warned by the storage arm of the usage-alerts cron.
  if (await companyOverStorageBudget(db, args.companyId)) {
    console.warn(
      `inbound media for message ${args.messageId} DROPPED — company ` +
        `${args.companyId} is at/over its storage budget (#12 cap-and-drop)`,
    );
    return;
  }

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
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      item.content_type ||
      "";
    if (!(INBOUND_MEDIA_TYPES as readonly string[]).includes(contentType)) {
      // Permanent condition (e.g. video/audio MMS): skipping is the §7
      // validation outcome — retrying would never change it.
      console.warn(
        `inbound media ${index} for message ${args.messageId} has unsupported type — skipped`,
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
