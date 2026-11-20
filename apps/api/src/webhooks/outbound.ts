import { WEBHOOK_ENDPOINT_CAP } from '@loonext/shared';
import type { WebhookEventType } from '@loonext/shared';

import type { SupabaseClient } from "@supabase/supabase-js";

import { reportHandledFailure, workerEnv } from "../observability/capture";

/**
 * #243 — one place events leave the building.
 *
 * Every choke point that wants to tell a workspace's other systems something
 * calls `emitWebhookEvent`. It writes delivery rows and returns; the sweeper
 * cron does the POSTing. Nothing here talks to the network, which is the
 * property that makes it safe to call from the middle of a send.
 */

/**
 * The envelope, and therefore a public contract.
 *
 * `id` is the delivery id, so a receiver that stores it gets deduplication of
 * redeliveries for free — the same event retried carries the same id, and a
 * webhook that retries without one forces every integrator to invent their own
 * idempotency key from the body.
 */
export type WebhookEnvelope = {
  id: string;
  type: WebhookEventType;
  created_at: string;
  company_id: string;
  data: Record<string, unknown>;
};

export type OutboundWebhookEvent = {
  companyId: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
};

type WebhookEventBatch = {
  companyId: string;
  type: WebhookEventType;
  payloads: readonly Record<string, unknown>[];
};

/**
 * Write one delivery row per subscribed, active endpoint. Returns how many.
 *
 * Separate from the fire-and-forget wrapper so it is testable without an
 * execution context, and so the cron paths (which have no request to return)
 * can await it directly.
 */
export function enqueueWebhookEvent(
  db: SupabaseClient,
  event: OutboundWebhookEvent,
): Promise<number> {
  return enqueueWebhookEventBatch(db, {
    companyId: event.companyId,
    type: event.type,
    payloads: [event.data],
  });
}

export async function enqueueWebhookEventBatch(
  db: SupabaseClient,
  batch: WebhookEventBatch,
): Promise<number> {
  if (batch.payloads.length === 0) return 0;
  try {
    return await enqueue(db, batch);
  } catch (error) {
    void reportHandledFailure(workerEnv(), "webhook-enqueue", error);
    return 0;
  }
}

async function enqueue(
  db: SupabaseClient,
  { companyId, type, payloads }: WebhookEventBatch,
): Promise<number> {
  const { data: endpoints, error } = await db
    .from("webhook_endpoints")
    .select("id")
    .eq("company_id", companyId)
    .eq("active", true)
    // `contains` is PostgREST's `@>`: endpoints whose subscription list
    // includes this name. The GIN index on `events` is what keeps this from
    // reading every endpoint the workspace owns.
    .contains("events", [type])
    .limit(WEBHOOK_ENDPOINT_CAP);

  if (error) throw new Error(`webhook subscription lookup failed: ${error.message}`);
  if (!endpoints?.length) return 0;

  const createdAt = new Date().toISOString();
  const rows = payloads.flatMap((data) =>
    endpoints.map((endpoint: { id: string }) => {
      const id = crypto.randomUUID();
      const envelope: WebhookEnvelope = {
        id,
        type,
        created_at: createdAt,
        company_id: companyId,
        data,
      };
      return {
        id,
        company_id: companyId,
        endpoint_id: endpoint.id,
        event_type: type,
        payload: envelope,
      };
    }),
  );

  const { error: insertError } = await db.from("webhook_deliveries").insert(rows);
  if (insertError) throw new Error(`webhook enqueue failed: ${insertError.message}`);
  return rows.length;
}

/**
 * Fire-and-forget. Schedules the enqueue and returns immediately.
 *
 * A webhook subscription is something a workspace opted into for its own
 * convenience, and it must never be able to slow down or fail the thing it is
 * reporting on. An inbound message is stored and acknowledged to the carrier
 * whether or not the integration ledger accepts a row; a send goes out whether
 * or not anybody is listening. So this swallows its own failures by
 * construction and never propagates.
 */
export function emitWebhookEvent(
  c: { executionCtx: { waitUntil: (promise: Promise<unknown>) => void } } | undefined,
  db: SupabaseClient,
  event: OutboundWebhookEvent,
): void {
  const work = enqueueWebhookEvent(db, event).catch(() => undefined);
  try {
    c?.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests, and the `app.request()` path): the promise
    // is already running and already swallows its own failures.
  }
}
