import { getStripe } from "./stripe";
import type { Env } from "../env";

export interface SegmentUsage {
  stripeCustomerId: string;
  /** Outbound segments to bill (MMS rows carry 3 — SPEC §2, §9). */
  value: number;
  /** `telnyx_message_id` — Stripe's ≥24h identifier dedupe backstop (SPEC §9). */
  identifier: string;
}

/** D36: one forward leg's billable SECONDS for the voice meter. */
export interface VoiceSecondsUsage {
  stripeCustomerId: string;
  /** Answered forwarded-leg seconds to bill — the SAME raw-seconds measure
   *  the allowance gate, alerts, and usage screen sum, so the Stripe bill can
   *  never diverge from what the app shows (review finding: a per-leg
   *  ceil-to-minutes report inflated short calls unboundedly vs the gate). */
  value: number;
  /** `call_leg_id` — Stripe's ≥24h identifier dedupe backstop. */
  identifier: string;
}

/**
 * Report one usage event to the SPEC §9 metering pipeline:
 * `POST /v1/billing/meter_events` with the given meter's `event_name` and
 * the payload keys the meter's customer/value mapping declares
 * (`stripe_customer_id`, `value` — see scripts/stripe-setup.ts).
 *
 * Idempotency is layered (SPEC §9): the caller gates on its local
 * `stripe_reported_at` stamp (the real gate) and `identifier` makes accidental
 * rapid retries harmless on Stripe's side. Throws on failure so the caller
 * leaves the stamp NULL for the hourly re-reporter cron.
 */
async function reportMeterEvent(
  env: Env,
  eventName: string,
  usage: { stripeCustomerId: string; value: number; identifier: string },
): Promise<void> {
  if (!Number.isInteger(usage.value) || usage.value < 1) {
    throw new Error(
      `reportMeterEvent(${eventName}): value must be a positive integer, got ${usage.value}`,
    );
  }
  await getStripe(env).billing.meterEvents.create({
    event_name: eventName,
    identifier: usage.identifier,
    payload: {
      stripe_customer_id: usage.stripeCustomerId,
      value: String(usage.value),
    },
  });
}

/** SMS segments → the `sms_segments` meter (SPEC §9). */
export async function reportSegmentUsage(
  env: Env,
  usage: SegmentUsage,
): Promise<void> {
  return reportMeterEvent(env, env.STRIPE_SMS_METER_EVENT_NAME, usage);
}

/**
 * D36 (#128): forwarded-leg seconds → the voice meter (`voice_seconds`; the
 * metered price rates 1¢ per 60 seconds, so "1¢ a minute" is billed to the
 * second). Throws when the voice meter isn't configured in this
 * environment — callers must guard on `env.STRIPE_VOICE_METER_EVENT_NAME`
 * (voice-webhook.ts stamps rows non-reportable at insert when it is unset,
 * so nothing ever queues).
 */
export async function reportVoiceSeconds(
  env: Env,
  usage: VoiceSecondsUsage,
): Promise<void> {
  if (!env.STRIPE_VOICE_METER_EVENT_NAME) {
    throw new Error("reportVoiceSeconds: STRIPE_VOICE_METER_EVENT_NAME is not set");
  }
  return reportMeterEvent(env, env.STRIPE_VOICE_METER_EVENT_NAME, usage);
}
