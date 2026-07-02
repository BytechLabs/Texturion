/**
 * The single Telnyx webhook route (SPEC §7): one URL per messaging profile is
 * Telnyx's delivery model (webhook_url and webhook_failover_url both point
 * here — 6 delivery attempts max, duplicates expected).
 *
 *   1. VERIFY   Ed25519 over `${telnyx-timestamp}|${rawBody}` (cross-track
 *               contract: src/telnyx/verify.ts) — 400 on failure.
 *   2. LEDGER   INSERT INTO webhook_events ON CONFLICT DO NOTHING;
 *               conflict → already seen → ack 200 and stop.
 *   3. ACK      200 immediately (well inside Telnyx's 2 s window).
 *   4. PROCESS  ctx.waitUntil: dispatch on data.event_type —
 *               message.received → inbound pipeline; message.sent /
 *               message.finalized → status pipeline; 10dlc.* →
 *               handle10dlcEvent (telnyx track). Unknown types → acked no-op.
 *   5. SWEEP    the §11 5-minute cron replays rows left unprocessed.
 *
 * Mounted by the integration layer at /webhooks/telnyx — exempt from JWT auth
 * (the signature IS the authentication) and never carries CORS headers.
 */
import { Hono } from "hono";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { dispatchTelnyxEvent } from "../messaging/dispatch";
import type { TelnyxEvent } from "../messaging/types";
import { verifyTelnyxWebhook } from "../telnyx/verify";

export const telnyxWebhookRoute = new Hono<AppEnv>();

telnyxWebhookRoute.post("/", async (c) => {
  const env = getEnv(c.env);

  // 1. VERIFY — reads the raw body; null on ANY failure (bad signature,
  // missing headers, >5-min skew).
  const event = (await verifyTelnyxWebhook(env, c.req.raw)) as
    | TelnyxEvent
    | null;
  if (!event) {
    return c.json({ error: "signature verification failed" }, 400);
  }

  const eventId = event.data?.id;
  const eventType = event.data?.event_type;
  if (typeof eventId !== "string" || !eventId || typeof eventType !== "string") {
    // Authentic (signed) but unusable envelope: ack so Telnyx stops retrying.
    return c.json({ received: true, ignored: true });
  }

  // 2. LEDGER — PK (provider, event_id) dedupe (D7).
  const db = getDb(env);
  const { data, error } = await db
    .from("webhook_events")
    .upsert(
      {
        provider: "telnyx",
        event_id: eventId,
        event_type: eventType,
        payload: event as Record<string, unknown>,
      },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (error) {
    throw new Error(`webhook_events insert failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return c.json({ received: true, duplicate: true });
  }

  // 3. ACK fast; 4. PROCESS in the background.
  c.executionCtx.waitUntil(processAndStamp(env, event, eventId));
  return c.json({ received: true });
});

/** Process + ledger bookkeeping (processed_at / attempts / last_error). */
async function processAndStamp(
  env: Env,
  event: TelnyxEvent,
  eventId: string,
): Promise<void> {
  const db = getDb(env);
  try {
    await dispatchTelnyxEvent(env, event);
    const { error } = await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "telnyx")
      .eq("event_id", eventId);
    if (error) {
      throw new Error(`webhook_events stamp failed: ${error.message}`);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(
      `telnyx webhook ${eventId} (${event.data?.event_type}) failed:`,
      message,
    );
    const { data } = await db
      .from("webhook_events")
      .select("attempts")
      .eq("provider", "telnyx")
      .eq("event_id", eventId)
      .limit(1);
    const attempts =
      (data?.[0] as { attempts?: number } | undefined)?.attempts ?? 0;
    await db
      .from("webhook_events")
      .update({ attempts: attempts + 1, last_error: message.slice(0, 2000) })
      .eq("provider", "telnyx")
      .eq("event_id", eventId);
  }
}
