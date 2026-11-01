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
import { CAMPAIGN_PARAMS } from "@/lib/analytics/campaign-params";
import { readCompanyCookie } from "@/lib/company/cookie";
import { scrubUnknown } from "@/lib/observability/scrub";
import { whenTelemetryMayLoad } from "@/lib/perf/telemetry-gate";

/** PostHog Cloud (US) — same instance the API Worker captures to. */
export const POSTHOG_HOST = "https://us.i.posthog.com";

/** The SDK cuts the URL and referrer it keeps for first touch at 1000 characters. */
const MAX_URL = 1000;

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
  const referrer = typeof document === "undefined" ? "" : document.referrer;
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
          const moved = landing !== undefined && window.location.href !== landing;
          if (moved) keepLandingAttribution(client, landing, referrer);
          // Join client events to the server-side funnel: the API Worker
          // captures with distinct_id = company_id, so the signed-in client
          // identifies as the same UUID (from the persisted workspace cookie,
          // G12).
          const companyId = readCompanyCookie();
          if (companyId) client.identify(companyId);
          if (moved) recordLandingPageview(client, landing);
        },
      });
      return posthog;
    })
    .catch((cause) => {
      console.error("PostHog init failed:", cause);
      return null;
    });
}

type LandingClient = Pick<
  PostHog,
  "capture" | "register_for_session" | "get_session_id" | "persistence"
>;

/**
 * Runs before the SDK's first event when a client navigation moved the
 * visitor on before the SDK started. The SDK reads the first touch
 * (`$initial_*`) and the session entry (`$session_entry_*`) from the page it
 * starts on, so both are set to the landing page, and the landing page's
 * campaign parameters are kept for the session. A first touch or session from
 * an earlier visit is left as it was.
 */
function keepLandingAttribution(
  posthog: LandingClient,
  landing: string,
  referrer: string,
): void {
  const entry = {
    r: (referrer || "$direct").slice(0, MAX_URL),
    u: landing.slice(0, MAX_URL),
  };
  posthog.persistence?.register_once({ $initial_person_info: entry }, undefined);

  // Reading the session id starts the session, and a new session takes its
  // entry URL from the page the visitor is on now.
  const before: unknown = posthog.persistence?.props.$client_session_props;
  const sessionId = posthog.get_session_id();
  const session = posthog.persistence?.props.$client_session_props as
    | { sessionId?: string }
    | undefined;
  if (session && session !== before && session.sessionId === sessionId) {
    posthog.persistence?.register({ $client_session_props: { sessionId, props: entry } });
  }

  const url = new URL(landing);
  const campaign: Record<string, string> = {};
  for (const name of CAMPAIGN_PARAMS) {
    const value = url.searchParams.get(name);
    if (value) campaign[name] = value;
  }
  if (Object.keys(campaign).length > 0) posthog.register_for_session(campaign);
}

/**
 * Captures the landing page ahead of the SDK's own first pageview, which is
 * for the page the visitor is on now. A move that kept the path (an in-page
 * anchor, a query change) is the same page to the SDK, so nothing is added.
 */
function recordLandingPageview(posthog: LandingClient, landing: string): void {
  const url = new URL(landing);
  const now = new URL(window.location.href);
  if (url.origin === now.origin && url.pathname === now.pathname) return;
  posthog.capture("$pageview", {
    $current_url: landing,
    $host: url.host,
    $pathname: url.pathname,
  });
}
