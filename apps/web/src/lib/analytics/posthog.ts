/**
 * PostHog product analytics, browser side (D8, D12). The server half —
 * checkout_completed / first_outbound_sent / registration_submitted /
 * registration_approved, the D12 north-star funnel — is captured by the API
 * Worker (apps/api/src/analytics/posthog.ts) with `distinct_id = company_id`.
 * This module adds the client picture: sanitized pageviews (which surfaces a
 * company actually uses, and the marketing → signup path), identified to the
 * SAME company UUID so client and server events join in one funnel.
 *
 * D8 posture, enforced in config rather than by convention:
 * - autocapture OFF, session recording OFF, surveys OFF — feature events and
 *   UUIDs only, never DOM text.
 * - every event passes `sanitize_properties`: URL-ish properties lose their
 *   query string + fragment (search boxes and contact filters can embed
 *   phone numbers), and every remaining string is E.164-redacted / every
 *   `*name` key stripped via the shared scrubber.
 * - `distinct_id` is the company UUID from the workspace cookie — never a
 *   person, never PII.
 *
 * NEXT_PUBLIC_POSTHOG_KEY is OPTIONAL: unset makes `initPostHog` a silent
 * no-op (identical to the API's optional POSTHOG_API_KEY). When set, the SDK
 * loads via dynamic `import()` so posthog-js stays out of the main bundle.
 */
import type { PostHog } from "posthog-js";

import { publicEnv } from "@/env";
import { readCompanyCookie } from "@/lib/company/cookie";
import { scrubUnknown } from "@/lib/observability/scrub";

/** PostHog Cloud (US) — same instance the API Worker captures to. */
export const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * `sanitize_properties` hook (pure, runs on EVERY captured event), delegating
 * to the shared scrubber (lib/observability/scrub.ts, also Sentry's
 * beforeSend): URL-keyed strings (`$current_url`, `$referrer`, `$pathname`,
 * `$session_entry_url`, …) are cut at the query string/fragment at any
 * nesting depth, every other string is phone-redacted, every `*name` key is
 * stripped. UUIDs, counts, and flags pass through untouched (D8).
 */
export function sanitizeEventProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return scrubUnknown(properties) as Record<string, unknown>;
}

let loader: Promise<PostHog | null> | null = null;

/**
 * Idempotent, best-effort init from `instrumentation-client.ts`. Resolves
 * (never rejects) with the client, or null when analytics is off — an
 * analytics outage must never break page boot.
 *
 * `capture_pageview: "history_change"` covers both the initial load and App
 * Router client navigations (Next drives them through the History API), so
 * no React wiring is needed and marketing + app pages are both counted.
 */
export function initPostHog(): Promise<PostHog | null> {
  const key = publicEnv.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return Promise.resolve(null); // analytics off — silent no-op
  loader ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: POSTHOG_HOST,
        // D8: feature events + UUIDs only.
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        capture_pageview: "history_change",
        capture_pageleave: false,
        // No feature flags in use — skip the remote flags round-trip.
        advanced_disable_flags: true,
        // Anonymous marketing traffic stays anonymous; a profile exists only
        // once a workspace (company UUID) is identified.
        person_profiles: "identified_only",
        sanitize_properties: (properties) => sanitizeEventProperties(properties),
      });
      // Join client events to the server-side funnel: the API Worker captures
      // with distinct_id = company_id, so the signed-in client identifies as
      // the same UUID (from the persisted workspace cookie, G12).
      const companyId = readCompanyCookie();
      if (companyId) posthog.identify(companyId);
      return posthog;
    })
    .catch((cause) => {
      console.error("PostHog init failed:", cause);
      return null;
    });
  return loader;
}
