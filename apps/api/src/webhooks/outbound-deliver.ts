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
import { customerWebhookRefusal } from "../environments/policy";

/**
 * #243 — the half that talks to the network.
 *
 * Runs on the existing five-minute sweeper. Claims due deliveries through
 * `api_claim_webhook_deliveries` (which stamps the attempt under `for update
 * skip locked`, so an overlapping tick cannot send the same event twice),
 * POSTs each one, and writes down what happened.
 */

const MAX_DELIVERIES_PER_TICK = 300;

type ClaimedDelivery = {
  id: string;
  company_id: string;
  endpoint_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

type EndpointRow = {
  active: boolean;
  id: string;
  url: string;
  secret: string;
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
      await response.body?.cancel().catch(() => undefined);
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
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return {
      ok: false,
      status: null,
      // The NAME of the failure, never a message that could have been built
      // from the request we sent.
      error: name === "TimeoutError" ? "timed out" : `request failed (${name})`,
    };
  }
}

type DeliveryTotals = { delivered: number; failed: number; disabled: number };

async function stampDelivery(
  db: SupabaseClient,
  id: string,
  update: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("webhook_deliveries").update(update).eq("id", id);
  if (error) throw new Error(`webhook delivery stamp failed for ${id}: ${error.code}`);
}

async function deliverEndpointGroup(
  db: SupabaseClient,
  env: Env,
  endpoint: EndpointRow | undefined,
  deliveries: ClaimedDelivery[],
): Promise<DeliveryTotals> {
  const refusal = endpoint ? customerWebhookRefusal(env, endpoint.url) : "endpoint removed";
  if (!endpoint || !endpoint.active || refusal) {
    const error = endpoint?.active === false ? "endpoint paused" : refusal;
    for (const delivery of deliveries) {
      await stampDelivery(db, delivery.id, { status: "failed", last_error: error });
    }
    return { delivered: 0, failed: deliveries.length, disabled: 0 };
  }

  let delivered = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const attempt = await postOnce(endpoint, delivery);
    if (attempt.ok) {
      await stampDelivery(db, delivery.id, {
        status: "succeeded",
        response_status: attempt.status,
        delivered_at: new Date().toISOString(),
        last_error: null,
      });
      delivered += 1;
    } else {
      const delay = webhookRetryDelaySeconds(delivery.attempts);
      await stampDelivery(db, delivery.id, {
        status: delay === null ? "failed" : "pending",
        response_status: attempt.status,
        last_error: attempt.error,
        ...(delay === null ? {} : { next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() }),
      });
      failed += 1;
    }
  }

  const { data, error } = await db.rpc("api_record_webhook_delivery_outcome", {
    p_endpoint_id: endpoint.id,
    p_succeeded: delivered > 0,
    p_failed: failed,
    p_disable_after: WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  });
  if (error) throw new Error(`webhook outcome stamp failed for ${endpoint.id}: ${error.code}`);
  return { delivered, failed, disabled: data === true ? 1 : 0 };
}

export async function deliverWebhookBatch(
  db: SupabaseClient,
  env: Env,
  limit = 50,
): Promise<DeliveryTotals & { claimed: number }> {
  const { data: claimed, error } = await db.rpc("api_claim_webhook_deliveries", { p_limit: limit });
  if (error) throw new Error(`webhook delivery claim failed: ${error.message}`);
  const deliveries = (claimed ?? []) as ClaimedDelivery[];
  const totals = { claimed: deliveries.length, delivered: 0, failed: 0, disabled: 0 };
  if (deliveries.length === 0) return totals;

  const groups = new Map<string, ClaimedDelivery[]>();
  for (const delivery of deliveries) {
    const group = groups.get(delivery.endpoint_id);
    if (group) group.push(delivery);
    else groups.set(delivery.endpoint_id, [delivery]);
  }

  const { data: endpointRows, error: endpointError } = await db
    .from("webhook_endpoints")
    .select("id,url,secret,active")
    .in("id", [...groups.keys()]);
  if (endpointError) throw new Error(`webhook endpoint lookup failed: ${endpointError.message}`);
  const endpoints = new Map<string, EndpointRow>((endpointRows ?? []).map((row) => [row.id, row]));
  const results = await Promise.allSettled(
    [...groups].map(([id, group]) => deliverEndpointGroup(db, env, endpoints.get(id), group)),
  );
  const errors: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(result.reason);
    } else {
      totals.delivered += result.value.delivered;
      totals.failed += result.value.failed;
      totals.disabled += result.value.disabled;
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "outbound webhook delivery failed");
  return totals;
}

export async function deliverOutboundWebhooks(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { delivered, failed, disabled } = await deliverWebhookBatch(db, env, MAX_DELIVERIES_PER_TICK);
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
