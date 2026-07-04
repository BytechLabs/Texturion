/**
 * PostHog product analytics (SPEC §12 step 18): ONE capture helper for the
 * north-star funnel events — checkout_completed, first_outbound_sent,
 * registration_submitted, registration_approved.
 *
 * distinct_id is ALWAYS the company_id — never a person, never PII (SPEC §10:
 * no message bodies, emails, or phone numbers in third-party telemetry).
 * POSTHOG_API_KEY is OPTIONAL: unset (local dev, tests) makes every capture a
 * silent no-op. Captures are best-effort — a PostHog outage or bad response
 * must never break the send/webhook path that fired the event, so failures
 * are swallowed (console + Sentry breadcrumb only).
 */
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../env";

/** PostHog Cloud (US) capture endpoint. */
export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";

/**
 * Capture one product event keyed on the company. Resolves (never rejects)
 * whether the capture succeeded, failed, or analytics is off — callers may
 * await it without any error handling of their own.
 */
export async function capture(
  env: Env,
  event: string,
  companyId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return; // analytics off — silent no-op

  try {
    const response = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event,
        distinct_id: companyId,
        properties,
      }),
      // Analytics must never stall a send or a webhook: cap the round-trip.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`PostHog answered HTTP ${response.status}`);
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`posthog capture '${event}' failed:`, detail);
    Sentry.addBreadcrumb({
      category: "analytics",
      message: `posthog capture '${event}' failed: ${detail}`,
      level: "warning",
    });
  }
}
