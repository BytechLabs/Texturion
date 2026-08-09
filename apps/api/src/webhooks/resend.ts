import { Hono } from "hono";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { countWebhookRejection } from "../observability/webhook-rejections";

/**
 * #386 — the Resend webhook: the half of email that was never wired up.
 *
 * `sendEmail` returned an accepted-id and nothing else. Accepted means we
 * queued it; whether it arrived, hard-bounced, or was reported as spam was
 * information we never asked for. This is where the answer comes back.
 *
 * Same contract as the Stripe and Telnyx endpoints (SPEC §7): VERIFY on the
 * raw body → LEDGER into `webhook_events` (PK dedupe; conflict → ack and
 * stop) → ACK fast → PROCESS in `waitUntil`. The five-minute sweeper replays
 * anything left unprocessed, so this needs no retry machinery of its own.
 * (Spelled out rather than written as the cron expression: the star-slash in
 * that expression closes a block comment.)
 *
 * Mounted at /webhooks/resend — exempt from JWT auth (the signature IS the
 * authentication) and never carries CORS headers.
 */
export const resendWebhookRoute = new Hono<AppEnv>();

/** Svix tolerates 5 minutes of clock skew; replay past that is rejected. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

/**
 * Verify a Svix-signed webhook (Resend's transport).
 *
 * The signed payload is `${id}.${timestamp}.${body}` and the header carries a
 * space-separated list of `v1,<base64>` — plural because Svix rotates secrets
 * by sending both. Any one matching is a pass, so a secret rotation does not
 * drop events.
 *
 * Compared with a constant-time walk rather than `===`: signature comparison
 * is the one place in this file where an early return leaks information.
 */
export async function verifyResendSignature(
  secret: string,
  headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
  rawBody: string,
  now: Date,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (skew > TIMESTAMP_TOLERANCE_SECONDS) return false;

  // Svix secrets are `whsec_<base64>`; the bytes are what signs, not the label.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(rawSecret), (char) => char.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  for (const candidate of signature.split(" ")) {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || !value) continue;
    if (timingSafeEqual(value, expected)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

resendWebhookRoute.post("/", async (c) => {
  const env = getEnv(c.env);

  // An unconfigured secret must not mean "accept anything". Refusing outright
  // is the honest arm: the events pile up at Resend and get redelivered once
  // the secret is set, whereas trusting an unsigned body would let anybody
  // suppress any address in the product.
  if (!env.RESEND_WEBHOOK_SECRET) {
    // #581/16: counted, like a bad signature is. This is the MOST likely Resend
    // misconfiguration — a secret cleared or never copied into an environment — and it
    // returned before the counter, so the one arrangement the alarm exists to catch
    // was the one arrangement that recorded nothing at all. Every delivery is refused
    // either way; what differs is whether anybody finds out.
    countWebhookRejection(c, "resend");
    return c.json({ error: "resend webhooks are not configured" }, 503);
  }

  // 1. VERIFY on the raw body — any re-serialization breaks the signature.
  const rawBody = await c.req.text();
  const ok = await verifyResendSignature(
    env.RESEND_WEBHOOK_SECRET,
    {
      id: c.req.header("svix-id"),
      timestamp: c.req.header("svix-timestamp"),
      signature: c.req.header("svix-signature"),
    },
    rawBody,
    new Date(),
  );
  if (!ok) {
    // #308: counted, because a rotated secret otherwise means we refuse every
    // bounce and complaint Resend sends and nothing anywhere says so.
    countWebhookRejection(c, "resend");
    return c.json({ error: "signature verification failed" }, 400);
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return c.json({ error: "malformed payload" }, 400);
  }

  // 2. LEDGER. Svix's message id is the dedupe key — Resend redelivers with
  // the same one, which is exactly what the PK conflict is for.
  const eventId = c.req.header("svix-id") ?? event.data?.email_id;
  if (!eventId) {
    return c.json({ error: "no event id to dedupe on" }, 400);
  }

  const db = getDb(env);
  const { data, error } = await db
    .from("webhook_events")
    .upsert(
      {
        provider: "resend",
        event_id: eventId,
        event_type: event.type,
        payload: event as unknown as Record<string, unknown>,
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
  c.executionCtx.waitUntil(processAndStamp(env, eventId, event));
  return c.json({ received: true });
});

/** Which Resend events carry information we act on. */
const HANDLED: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function processResendEvent(env: Env, event: ResendEvent): Promise<void> {
  const kind = HANDLED[event.type];
  // Resend sends email.sent, email.opened, email.clicked and others. Recording
  // them would grow the table without changing a decision anywhere.
  if (!kind) return;

  const db = getDb(env);
  const recipients = Array.isArray(event.data?.to)
    ? event.data.to
    : event.data?.to
      ? [event.data.to]
      : [];
  const occurredAt = event.created_at ?? new Date().toISOString();

  for (const address of recipients) {
    const { error } = await db.rpc("record_email_event", {
      p_email: address,
      p_event: kind,
      p_occurred_at: occurredAt,
      // Resend reports 'Permanent' or 'Transient'. Only a permanent bounce
      // suppresses — a full mailbox is not a dead address, and treating it as
      // one would silence a paying customer's crew over a bad week.
      p_bounce_type: event.data?.bounce?.type ?? null,
      p_resend_id: event.data?.email_id ?? null,
      p_subject: event.data?.subject ?? null,
    });
    if (error) {
      throw new Error(`record_email_event failed: ${error.message}`);
    }
  }
}

/** Process + ledger bookkeeping, mirroring the Stripe/Telnyx handlers. */
async function processAndStamp(
  env: Env,
  eventId: string,
  event: ResendEvent,
): Promise<void> {
  const db = getDb(env);
  try {
    await processResendEvent(env, event);
    const { error } = await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "resend")
      .eq("event_id", eventId);
    if (error) throw new Error(`webhook_events stamp failed: ${error.message}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`resend webhook ${eventId} (${event.type}) failed:`, message);
    await db
      .from("webhook_events")
      .update({ last_error: message })
      .eq("provider", "resend")
      .eq("event_id", eventId);
    throw cause;
  }
}
