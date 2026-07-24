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

import {
  dispatchInboundCallEvent,
  shouldRouteToDO,
  warnIfEchoDropped,
} from "../calls/webhook-router";
import { recordVoiceCost } from "../billing/provider-costs";
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

  // #216: call.cost is a BILLING event (fired per leg at call end), not a
  // call-STATE event — it must never reach the DO. Record the actual per-leg
  // cost (idempotent via provider_costs PK; recordVoiceCost is best-effort) and
  // ACK. Only on the fresh ledger insert; a duplicate POST already recorded it.
  if (eventType === "call.cost") {
    if (data && data.length > 0) {
      await recordVoiceCost(
        db,
        event.data?.payload,
        typeof event.data?.occurred_at === "string"
          ? event.data.occurred_at
          : null,
      );
      await stampProcessed(db, eventId);
    }
    return c.json({ received: true });
  }

  // Calls v3 (#170 §7.2): inbound-family call.* events are ADMITTED to the DO
  // in the REQUEST PATH before the ACK — a lost event then rides Telnyx's own
  // fast retry ladder instead of our ≥2-min sweeper (an admitted call.answered
  // must never fall to the t+45 alarm).
  const routeToDO = shouldRouteToDO(event as TelnyxEvent);
  // #211: breadcrumb an un-attributable hangup (echo dropped its tag+direction).
  warnIfEchoDropped(event as TelnyxEvent);

  if (!data || data.length === 0) {
    // Duplicate POST. §7.2 companion rule: for an inbound-family event whose
    // ledger row is still UNSTAMPED, RE-DISPATCH (DO dedup makes double
    // admission a no-op) instead of pure-acking {duplicate:true} forever.
    if (routeToDO) {
      const { data: existing } = await db
        .from("webhook_events")
        .select("processed_at")
        .eq("provider", "telnyx")
        .eq("event_id", eventId)
        .limit(1);
      const processedAt = (existing?.[0] as { processed_at: string | null } | undefined)
        ?.processed_at;
      if (!processedAt) {
        const stamp = await dispatchInboundCallEvent(env, event as TelnyxEvent);
        if (stamp) await stampProcessed(db, eventId);
        return c.json({ received: true, redispatched: true });
      }
    }
    return c.json({ received: true, duplicate: true });
  }

  if (routeToDO) {
    // Await admission (the DO returns at the §4.1 step-1 persist; effects
    // complete via the journal-resume alarm even under immediate eviction),
    // then stamp + ACK. A no-row inbound hangup returns stamp=false so the
    // sweeper can replay it (§7.5.1).
    const stamp = await dispatchInboundCallEvent(env, event as TelnyxEvent);
    if (stamp) await stampProcessed(db, eventId);
    return c.json({ received: true });
  }

  // 3. ACK fast; 4. PROCESS in the background (non-call events + the
  // consult/transfer (brc/brt) legs, which are not full DO sessions).
  c.executionCtx.waitUntil(processAndStamp(env, event, eventId));
  return c.json({ received: true });
});

/** Stamp processed_at for a DO-admitted inbound-family event (best-effort). */
async function stampProcessed(
  db: ReturnType<typeof getDb>,
  eventId: string,
): Promise<void> {
  const { error } = await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "telnyx")
    .eq("event_id", eventId);
  if (error) {
    console.error(`webhook_events stamp failed (v3 admit): ${error.message}`);
  }
}

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
