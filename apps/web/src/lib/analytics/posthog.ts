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

import { clientEnv } from "@/public-env";
import { readCompanyCookie } from "@/lib/company/cookie";
import { scrubUnknown } from "@/lib/observability/scrub";
import { whenTelemetryMayLoad } from "@/lib/perf/telemetry-gate";

/** PostHog Cloud (US) — same instance the API Worker captures to. */
export const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * The campaign and ad click-id parameters posthog-js reads from the page URL
 * (its CAMPAIGN_PARAMS list).
 */
const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gad_source",
  "mc_cid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "igshid",
  "ttclid",
  "rdt_cid",
  "epik",
  "qclid",
  "sccid",
  "irclid",
  "_kx",
] as const;

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
 *
 * On a marketing page the SDK downloads only once the page has settled
 * (#640): fetched with the page, it joined the LCP that Lighthouse simulates.
 * Events captured before then wait on this promise and are sent once it
 * resolves.
 */
export function initPostHog(): Promise<PostHog | null> {
  const key = clientEnv.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return Promise.resolve(null); // analytics off — silent no-op
  loader ??= loadPostHog(key);
  return loader;
}

function loadPostHog(key: string): Promise<PostHog | null> {
  // Read now: a client navigation before the SDK starts replaces it.
  const landing = typeof window === "undefined" ? undefined : window.location.href;
  return whenTelemetryMayLoad()
    .then(() => import("posthog-js"))
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: POSTHOG_HOST,
        // D8: feature events + UUIDs only.
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        capture_pageview: "history_change",
        capture_pageleave: false,
        // COOKIELESS BY CONFIGURATION, not by accident: the privacy policy
        // states analytics sets no cookies, so persistence is pinned to
        // localStorage (PostHog's default "localStorage+cookie" would write a
        // ph_* cookie). Do not change without changing the legal copy first.
        persistence: "localStorage",
        // No feature flags in use — skip the remote flags round-trip.
        advanced_disable_flags: true,
        // Anonymous marketing traffic stays anonymous; a profile exists only
        // once a workspace (company UUID) is identified.
        person_profiles: "identified_only",
        sanitize_properties: (properties) => sanitizeEventProperties(properties),
        // Runs inside init, before the SDK's own first pageview.
        loaded: (client) => {
          // Join client events to the server-side funnel: the API Worker
          // captures with distinct_id = company_id, so the signed-in client
          // identifies as the same UUID (from the persisted workspace cookie,
          // G12).
          const companyId = readCompanyCookie();
          if (companyId) client.identify(companyId);
          if (landing) recordLandingPage(client, landing);
        },
      });
      return posthog;
    })
    .catch((cause) => {
      console.error("PostHog init failed:", cause);
      return null;
    });
}

/**
 * Runs before the SDK's own first pageview, which reads the URL the visitor
 * is on now. When a client navigation moved them on before the SDK started,
 * capture the landing page first and keep its campaign parameters for the
 * session, which is what the SDK records when it starts on the landing page.
 */
export function recordLandingPage(
  posthog: Pick<PostHog, "capture" | "register_for_session">,
  landing: string,
): void {
  if (window.location.href === landing) return;
  const url = new URL(landing);
  const campaign: Record<string, string> = {};
  for (const name of CAMPAIGN_PARAMS) {
    const value = url.searchParams.get(name);
    if (value) campaign[name] = value;
  }
  if (Object.keys(campaign).length > 0) posthog.register_for_session(campaign);
  posthog.capture("$pageview", {
    $current_url: landing,
    $host: url.host,
    $pathname: url.pathname,
  });
}
