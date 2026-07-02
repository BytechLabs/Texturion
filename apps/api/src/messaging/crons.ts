/**
 * Messaging-track scheduled jobs (SPEC §11). Both are idempotent and safe to
 * re-run: work items are selected by state, never by "last run" bookkeeping.
 *
 *   sweepWebhookEvents  (*\/5)  — replay `webhook_events` rows still
 *     unprocessed after 2 minutes (waitUntil died, transient failure), up to
 *     5 attempts; the 5th failure raises a Sentry alert. Telnyx rows replay
 *     through the same dispatch as the live route; Stripe rows through the
 *     billing track's processStripeEvent — durability without Queues (D11).
 *
 *   reportUnreportedUsage  (hourly)  — re-POST Stripe meter events for
 *     usage_events where stripe_reported_at IS NULL (the local stamp is the
 *     gate; Stripe's identifier dedupe is the ≥24h safeguard, §9).
 */
import * as Sentry from "@sentry/cloudflare";

import { reportSegmentUsage } from "../billing/meter";
import { getDb } from "../db";
import type { Env } from "../env";
import { processStripeEvent } from "../webhooks/stripe";
import { dispatchTelnyxEvent } from "./dispatch";
import type { TelnyxEvent } from "./types";

const SWEEP_MIN_AGE_MS = 2 * 60 * 1000;
const SWEEP_MAX_ATTEMPTS = 5;
const SWEEP_BATCH = 100;

interface WebhookEventRow {
  provider: "telnyx" | "stripe";
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** §11 webhook sweeper: reprocess the unprocessed ledger tail. */
export async function sweepWebhookEvents(env: Env): Promise<void> {
  const db = getDb(env);
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MS).toISOString();

  const { data, error } = await db
    .from("webhook_events")
    .select("provider,event_id,event_type,payload,attempts")
    .is("processed_at", null)
    .lt("received_at", cutoff)
    .lt("attempts", SWEEP_MAX_ATTEMPTS)
    .order("received_at", { ascending: true })
    .limit(SWEEP_BATCH);
  if (error) throw new Error(`webhook_events sweep query failed: ${error.message}`);

  for (const row of (data ?? []) as WebhookEventRow[]) {
    try {
      if (row.provider === "telnyx") {
        await dispatchTelnyxEvent(env, row.payload as TelnyxEvent);
      } else {
        await processStripeEvent(
          env,
          row.payload as unknown as Parameters<typeof processStripeEvent>[1],
        );
      }
      const { error: stampError } = await db
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("provider", row.provider)
        .eq("event_id", row.event_id);
      if (stampError) {
        throw new Error(`sweep stamp failed: ${stampError.message}`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const attempts = row.attempts + 1;
      console.error(
        `sweep of ${row.provider} ${row.event_id} (${row.event_type}) failed (attempt ${attempts}):`,
        message,
      );
      await db
        .from("webhook_events")
        .update({ attempts, last_error: message.slice(0, 2000) })
        .eq("provider", row.provider)
        .eq("event_id", row.event_id);
      if (attempts >= SWEEP_MAX_ATTEMPTS) {
        // §11: Sentry alert at attempt 5 — IDs only, never payload bodies (§10).
        Sentry.captureMessage(
          `webhook ${row.provider}/${row.event_id} (${row.event_type}) failed ${attempts} times`,
          "error",
        );
      }
    }
  }
}

const REPORT_BATCH = 200;

interface UnreportedUsageRow {
  id: string;
  quantity: number;
  meter_identifier: string | null;
  companies: { stripe_customer_id: string | null } | null;
}

/** §11 usage re-reporter: meter events for locally-unstamped usage rows. */
export async function reportUnreportedUsage(env: Env): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("usage_events")
    .select("id,quantity,meter_identifier,companies(stripe_customer_id)")
    .is("stripe_reported_at", null)
    .order("created_at", { ascending: true })
    .limit(REPORT_BATCH);
  if (error) throw new Error(`usage re-report query failed: ${error.message}`);

  for (const row of (data ?? []) as unknown as UnreportedUsageRow[]) {
    const stripeCustomerId = row.companies?.stripe_customer_id;
    if (!stripeCustomerId) continue; // company not billed yet — try next hour
    try {
      await reportSegmentUsage(env, {
        stripeCustomerId,
        value: row.quantity,
        // telnyx_message_id when the row has one; the usage-event id keeps
        // adjustment rows deduped on Stripe's side too.
        identifier: row.meter_identifier ?? row.id,
      });
    } catch (cause) {
      console.error(
        `usage re-report failed for ${row.id}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
      continue; // stays unstamped; next hourly run retries
    }
    const { error: stampError } = await db
      .from("usage_events")
      .update({ stripe_reported_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("stripe_reported_at", null);
    if (stampError) {
      throw new Error(`stripe_reported_at stamp failed: ${stampError.message}`);
    }
  }
}
