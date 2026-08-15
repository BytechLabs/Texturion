import {
  WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_ERROR_EXCERPT_LIMIT,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
  webhookRetryDelaySeconds,
  webhookSignatureHeader,
  webhookSignaturePayload,
} from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/**
 * #243 — the half that talks to the network.
 *
 * Runs on the existing five-minute sweeper. Claims due deliveries through
 * `api_claim_webhook_deliveries` (which stamps the attempt under `for update
 * skip locked`, so an overlapping tick cannot send the same event twice),
 * POSTs each one, and writes down what happened.
 */

type ClaimedDelivery = {
  id: string;
  company_id: string;
  endpoint_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

type EndpointRow = {
  id: string;
  url: string;
  secret: string;
  consecutive_failures: number;
};

/** HMAC-SHA256, hex. WebCrypto because Workers has no node:crypto sync path. */
async function signBody(secret: string, material: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(material));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Attempt = { ok: true; status: number } | { ok: false; status: number | null; error: string };

async function postOnce(endpoint: EndpointRow, delivery: ClaimedDelivery): Promise<Attempt> {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signBody(
    endpoint.secret,
    webhookSignaturePayload(timestamp, body),
  );

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(timestamp, signature),
        [WEBHOOK_EVENT_HEADER]: delivery.event_type,
        [WEBHOOK_DELIVERY_HEADER]: delivery.id,
        "user-agent": "Loonext-Webhooks/1",
      },
      body,
      // A receiver that never answers must not hold a cron invocation open.
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      // A webhook is a POST to a fixed address. Following a redirect would let
      // a receiver bounce our signed payload somewhere we never validated — the
      // SSRF gate checked the URL they gave us, not wherever a 302 points.
      redirect: "manual",
    });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }

    // The excerpt is the RECEIVER's own response, which is why it is safe to
    // store: it is their error page, not our customer's message. Nothing from
    // the payload goes into `last_error` — #513's lesson is that an error
    // string built out of the thing that failed smuggles its value into a
    // place with different access rules.
    let excerpt = "";
    try {
      excerpt = (await response.text()).slice(0, WEBHOOK_ERROR_EXCERPT_LIMIT);
    } catch {
      excerpt = "";
    }
    return {
      ok: false,
      status: response.status,
      error: excerpt ? `HTTP ${response.status}: ${excerpt}` : `HTTP ${response.status}`,
    };
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "Error";
    return {
      ok: false,
      status: null,
      // The NAME of the failure, never a message that could have been built
      // from the request we sent.
      error: name === "TimeoutError" ? "timed out" : `request failed (${name})`,
    };
  }
}

/**
 * Deliver one claimed batch. Returns a small tally for the cron's log line.
 *
 * The per-endpoint failure counter is read from the row we already fetched and
 * written back, so two overlapping sweeps could each miss the other's
 * increment. That is deliberate rather than overlooked: the counter drives a
 * heuristic — "this endpoint has been dead a while, stop calling it" — and an
 * occasional undercount delays a disable by one round. Making it exact would
 * mean a lock on the endpoint row for every delivery, which is a real cost for
 * an imaginary problem.
 */
export async function deliverWebhookBatch(
  db: SupabaseClient,
  limit = 50,
): Promise<{ claimed: number; delivered: number; failed: number; disabled: number }> {
  const { data: claimed, error } = await db.rpc("api_claim_webhook_deliveries", {
    p_limit: limit,
  });
  const deliveries = (claimed ?? []) as ClaimedDelivery[];
  if (error || deliveries.length === 0) {
    return { claimed: 0, delivered: 0, failed: 0, disabled: 0 };
  }

  const endpointIds = [...new Set(deliveries.map((d) => d.endpoint_id))];
  const { data: endpointRows } = await db
    .from("webhook_endpoints")
    .select("id, url, secret, consecutive_failures")
    .in("id", endpointIds);
  const endpoints = new Map<string, EndpointRow>(
    ((endpointRows ?? []) as EndpointRow[]).map((row) => [row.id, row]),
  );

  let delivered = 0;
  let failed = 0;
  let disabled = 0;
  // Per endpoint: did anything succeed, and how many failed.
  const outcomes = new Map<string, { successes: number; failures: number }>();

  for (const delivery of deliveries) {
    const endpoint = endpoints.get(delivery.endpoint_id);
    if (!endpoint) {
      // The endpoint was deleted between enqueue and now. The delivery has
      // nowhere to go and no future attempt can change that.
      await db
        .from("webhook_deliveries")
        .update({ status: "failed", last_error: "endpoint removed" })
        .eq("id", delivery.id);
      failed += 1;
      continue;
    }

    const tally = outcomes.get(endpoint.id) ?? { successes: 0, failures: 0 };
    const attempt = await postOnce(endpoint, delivery);

    if (attempt.ok) {
      await db
        .from("webhook_deliveries")
        .update({
          status: "succeeded",
          response_status: attempt.status,
          delivered_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", delivery.id);
      tally.successes += 1;
      delivered += 1;
    } else {
      // `attempts` was already incremented by the claim, so it is the number
      // of attempts INCLUDING this one — which is exactly what the schedule
      // wants when asked for the next gap.
      const delay = webhookRetryDelaySeconds(delivery.attempts);
      await db
        .from("webhook_deliveries")
        .update(
          delay === null
            ? {
                status: "failed",
                response_status: attempt.status,
                last_error: attempt.error,
              }
            : {
                status: "pending",
                response_status: attempt.status,
                last_error: attempt.error,
                next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
              },
        )
        .eq("id", delivery.id);
      tally.failures += 1;
      failed += 1;
    }
    outcomes.set(endpoint.id, tally);
  }

  const now = new Date().toISOString();
  for (const [endpointId, tally] of outcomes) {
    const endpoint = endpoints.get(endpointId);
    if (!endpoint) continue;

    if (tally.successes > 0) {
      // Any success clears the streak. An endpoint that is up but rejecting
      // one malformed event is not a dead endpoint, and disabling it would
      // punish the workspace for our payload.
      await db
        .from("webhook_endpoints")
        .update({ consecutive_failures: 0, last_success_at: now })
        .eq("id", endpointId);
      continue;
    }

    const streak = endpoint.consecutive_failures + tally.failures;
    const shouldDisable = streak >= WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES;
    await db
      .from("webhook_endpoints")
      .update({
        consecutive_failures: streak,
        last_failure_at: now,
        ...(shouldDisable
          ? {
              active: false,
              disabled_at: now,
              // Written as a catalogue KEY, not a sentence: this reaches three
              // clients in two languages, and a English string stored in the
              // database is one no phone can translate.
              disabled_reason: "webhooks.disabled.tooManyFailures",
            }
          : {}),
      })
      .eq("id", endpointId);
    if (shouldDisable) disabled += 1;
  }

  return { claimed: deliveries.length, delivered, failed, disabled };
}

/**
 * The cron entry point, on the existing five-minute sweeper.
 *
 * Batches until the queue is drained or the ceiling is hit. The ceiling exists
 * because a cron invocation has a wall clock and a subrequest budget, and a
 * workspace that just enabled a webhook against a busy inbox can present a
 * backlog far larger than one tick should try to clear — the next tick is five
 * minutes away, which is the right amount of patience for a queue that is
 * already behind.
 */
const MAX_BATCHES_PER_TICK = 6;

export async function deliverOutboundWebhooks(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  let delivered = 0;
  let failed = 0;
  let disabled = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
    const result = await deliverWebhookBatch(db);
    delivered += result.delivered;
    failed += result.failed;
    disabled += result.disabled;
    if (result.claimed === 0) break;
  }

  if (delivered > 0 || failed > 0) {
    console.log(
      `outbound webhooks: ${delivered} delivered, ${failed} failed, ${disabled} endpoint(s) disabled`,
    );
  }
  return delivered;
}

/**
 * The 30-day window `docs/PERSONAL-DATA-INVENTORY.md` §5 publishes for
 * `webhook_deliveries`.
 *
 * The window lives in the SQL function rather than being passed in, because
 * this table's payloads are the workspace's own message content and the
 * retention answer should not be a caller's opinion. #581's lesson is the
 * other half: a published window that nothing calls is a claim, not a policy,
 * so this job is the thing that makes the document true.
 */
export async function pruneWebhookDeliveries(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("api_prune_webhook_deliveries", {
    p_limit: 5000,
  });
  if (error) {
    throw new Error(`webhook_deliveries prune failed: ${error.message}`);
  }

  const deleted = (data as number) ?? 0;
  if (deleted > 0) {
    console.log(`webhook_deliveries prune deleted ${deleted} row(s)`);
  }
  return deleted;
}
