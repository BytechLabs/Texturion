/**
 * Status pipeline for Telnyx `message.sent` / `message.finalized`
 * (SPEC §7, §8, §9):
 *
 *   message.sent      → messages.status = 'sent' (queued rows only — never
 *                       regress a finalized row on out-of-order delivery).
 *   message.finalized → 'delivered' | 'failed' (+ error_code/error_detail —
 *                       Telnyx 40300 carrier blocks are surfaced, never
 *                       silent, §5), authoritative parts + encoding stored,
 *                       provider_cost when present; then the §9 metering
 *                       step for outbound rows: INSERT usage_events (the
 *                       partial unique on message_id makes a duplicate
 *                       delivery a no-op) → Stripe meter event
 *                       (identifier = telnyx_message_id) → stamp
 *                       stripe_reported_at.
 *
 * Status webhooks whose telnyx_message_id matches no row are acked no-ops
 * (§8) — e.g. a `sent` racing the send route's telnyx_message_id persist.
 */
import { reportSegmentUsage } from "../billing/meter";
import { getDb } from "../db";
import type { Env } from "../env";
import type { TelnyxEvent, TelnyxMessagePayload } from "./types";
import { MMS_SEGMENTS } from "./media";

/** message.sent / message.finalized entry point (dispatched from §7 route). */
export async function handleStatusEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<void> {
  const eventType = event.data?.event_type;
  const payload = event.data?.payload;
  const telnyxMessageId = payload?.id;
  if (!payload || typeof telnyxMessageId !== "string" || !telnyxMessageId) {
    console.warn(`${eventType} with unusable payload — ignored`);
    return;
  }

  if (eventType === "message.sent") {
    await markSent(env, telnyxMessageId);
    return;
  }
  if (eventType === "message.finalized") {
    await finalize(env, telnyxMessageId, payload);
  }
}

async function markSent(env: Env, telnyxMessageId: string): Promise<void> {
  const db = getDb(env);
  const { error } = await db
    .from("messages")
    .update({ status: "sent" })
    .eq("telnyx_message_id", telnyxMessageId)
    .eq("direction", "outbound")
    .eq("status", "queued"); // never regress delivered/failed (out-of-order)
  if (error) throw new Error(`message.sent update failed: ${error.message}`);
}

async function finalize(
  env: Env,
  telnyxMessageId: string,
  payload: TelnyxMessagePayload,
): Promise<void> {
  const db = getDb(env);

  const { data: rows, error: lookupError } = await db
    .from("messages")
    .select("id,company_id,direction")
    .eq("telnyx_message_id", telnyxMessageId)
    .limit(1);
  if (lookupError) {
    throw new Error(`finalized lookup failed: ${lookupError.message}`);
  }
  const message = (rows ?? [])[0] as
    | { id: string; company_id: string; direction: string }
    | undefined;
  if (!message) return; // unknown id → acked no-op (§8)

  const delivered =
    payload.to?.some((recipient) => recipient.status === "delivered") === true;
  const firstError = payload.errors?.[0];
  // Classify the terminal status honestly. "delivered" is confirmed success; a
  // non-delivered terminal is a real FAILURE only when Telnyx says so — a
  // populated error, or a recipient in the explicit failure set. Benign
  // terminals like "delivery_unconfirmed" (carrier returned no DLR — very
  // common for US/toll-free) mean the message WAS sent, so record "sent", not
  // a false-red "failed" the crew can't even retry (telnyx_message_id is set).
  const FAILURE_STATUSES = new Set(["delivery_failed", "sending_failed"]);
  const hasFailure =
    firstError !== undefined ||
    payload.to?.some((recipient) =>
      FAILURE_STATUSES.has(recipient.status ?? ""),
    ) === true;
  const finalStatus: "delivered" | "sent" | "failed" = delivered
    ? "delivered"
    : hasFailure
      ? "failed"
      : "sent";
  const parts =
    typeof payload.parts === "number" && payload.parts > 0
      ? payload.parts
      : null;
  const cost = Number(payload.cost?.amount);

  const { error: updateError } = await db
    .from("messages")
    .update({
      status: finalStatus,
      ...(parts !== null ? { segments: parts } : {}),
      ...(typeof payload.encoding === "string"
        ? { encoding: payload.encoding }
        : {}),
      ...(Number.isFinite(cost) ? { provider_cost: cost } : {}),
      // 40300 (and friends) surfaced on the row — blocked sends are never
      // silent (§5).
      error_code: firstError?.code ?? null,
      error_detail: firstError
        ? (firstError.detail || firstError.title || null)
        : null,
    })
    .eq("telnyx_message_id", telnyxMessageId);
  if (updateError) {
    throw new Error(`finalized update failed: ${updateError.message}`);
  }

  if (message.direction !== "outbound") return;

  // §9 metering: MMS meters as 3 segments (§2); SMS meters Telnyx's
  // authoritative parts. Sent-but-undelivered parts are still metered;
  // failed-before-send rows never reach here (no telnyx_message_id).
  const isMms = payload.type === "MMS";
  const quantity = isMms ? MMS_SEGMENTS : (parts ?? 1);

  const { data: usageRows, error: usageError } = await db
    .from("usage_events")
    .insert({
      company_id: message.company_id,
      message_id: message.id,
      type: isMms ? "mms_outbound" : "sms_outbound",
      quantity,
      meter_identifier: telnyxMessageId,
    })
    .select("id");
  if (usageError) {
    // usage_events_message_uq conflict = already metered by an earlier
    // delivery of this webhook — exactly-once billing (§9, D7).
    if (usageError.code === "23505") return;
    throw new Error(`usage_events insert failed: ${usageError.message}`);
  }
  const usageEventId = (usageRows ?? [])[0]?.id as string | undefined;
  if (!usageEventId) throw new Error("usage_events insert returned no row");

  await reportUsageEvent(env, {
    usageEventId,
    companyId: message.company_id,
    quantity,
    identifier: telnyxMessageId,
  });
}

/**
 * Fire the Stripe meter event and stamp stripe_reported_at (§9). Failures are
 * swallowed after logging: the local NULL stamp is the durable retry gate —
 * the hourly re-reporter cron picks the row up.
 */
async function reportUsageEvent(
  env: Env,
  args: {
    usageEventId: string;
    companyId: string;
    quantity: number;
    identifier: string;
  },
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select("stripe_customer_id")
    .eq("id", args.companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const stripeCustomerId = (data ?? [])[0]?.stripe_customer_id as
    | string
    | null
    | undefined;
  if (!stripeCustomerId) {
    console.warn(
      `usage event ${args.usageEventId} has no stripe customer yet — left for the re-reporter`,
    );
    return;
  }

  try {
    await reportSegmentUsage(env, {
      stripeCustomerId,
      value: args.quantity,
      identifier: args.identifier,
    });
  } catch (cause) {
    console.error(
      `meter report failed for usage event ${args.usageEventId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return; // stripe_reported_at stays NULL → hourly cron re-reports
  }

  const { error: stampError } = await db
    .from("usage_events")
    .update({ stripe_reported_at: new Date().toISOString() })
    .eq("id", args.usageEventId)
    .is("stripe_reported_at", null);
  if (stampError) {
    throw new Error(`stripe_reported_at stamp failed: ${stampError.message}`);
  }
}
