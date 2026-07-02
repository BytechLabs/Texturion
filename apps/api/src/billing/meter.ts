import { getStripe } from "./stripe";
import type { Env } from "../env";

export interface SegmentUsage {
  stripeCustomerId: string;
  /** Outbound segments to bill (MMS rows carry 3 — SPEC §2, §9). */
  value: number;
  /** `telnyx_message_id` — Stripe's ≥24h identifier dedupe backstop (SPEC §9). */
  identifier: string;
}

/**
 * Report one usage event to the SPEC §9 metering pipeline:
 * `POST /v1/billing/meter_events` with the meter's `event_name` from env and
 * the payload keys the meter's customer/value mapping declares
 * (`stripe_customer_id`, `value` — see scripts/stripe-setup.ts).
 *
 * Idempotency is layered (SPEC §9): the caller gates on
 * `usage_events.stripe_reported_at` (the local stamp is the real gate) and
 * `identifier` makes accidental rapid retries harmless on Stripe's side.
 * Throws on failure so the caller leaves `stripe_reported_at` NULL for the
 * hourly re-reporter cron.
 */
export async function reportSegmentUsage(
  env: Env,
  usage: SegmentUsage,
): Promise<void> {
  if (!Number.isInteger(usage.value) || usage.value < 1) {
    throw new Error(
      `reportSegmentUsage: value must be a positive integer, got ${usage.value}`,
    );
  }
  await getStripe(env).billing.meterEvents.create({
    event_name: env.STRIPE_SMS_METER_EVENT_NAME,
    identifier: usage.identifier,
    payload: {
      stripe_customer_id: usage.stripeCustomerId,
      value: String(usage.value),
    },
  });
}
