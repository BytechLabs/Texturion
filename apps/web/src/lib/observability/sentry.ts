/**
 * Sentry browser client (D13: "@sentry/cloudflare in both Workers + Next.js
 * client, with the D8 PII scrubbing" — this is the Next.js-client half; the
 * Workers half lives in apps/api/src/observability/sentry.ts).
 *
 * NEXT_PUBLIC_SENTRY_DSN is OPTIONAL: unset (local dev, CI, previews) makes
 * the whole module a silent no-op, mirroring the API's optional PostHog key.
 * When set, the SDK is pulled in via dynamic `import()` from
 * `instrumentation-client.ts`, so `@sentry/browser` ships as its own lazy
 * chunk and costs unconfigured deploys nothing.
 */
import type { BrowserOptions, ErrorEvent } from "@sentry/browser";

import { publicEnv } from "@/env";

import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * A bare network fetch failure (`TypeError: Failed to fetch` / Safari's `Load
 * failed`). These are the user's connectivity — a mobile signal drop, offline,
 * flaky wifi — or a total CORS/deploy misconfig (an immediate, obvious outage),
 * never a one-off app bug. Dropped so device connectivity never drowns real
 * signal. Catches the auto-instrumented (unhandled) paths; the react-query path
 * is gated the same way in app-providers.tsx.
 */
function isNetworkErrorEvent(event: ErrorEvent): boolean {
  return (event.exception?.values ?? []).some(
    (v) =>
      v.type === "TypeError" &&
      /failed to fetch|load failed|networkerror|network request failed/i.test(
        v.value ?? "",
      ),
  );
}

/** Options for `Sentry.init` — same PII posture as the API Worker (D8/§10). */
export function sentryClientOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) =>
      isNetworkErrorEvent(event) ? null : scrubEvent(event),
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

let started = false;

/**
 * Idempotent, best-effort init. Resolves (never rejects) whether Sentry
 * started, was already running, or is configured off — a failed SDK load
 * must never break page boot.
 */
export async function initSentryClient(): Promise<void> {
  const dsn = publicEnv.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || started) return; // observability off — silent no-op
  started = true;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.init(sentryClientOptions(dsn));
  } catch (cause) {
    console.error("Sentry browser init failed:", cause);
  }
}

/**
 * Report an unexpected client-side error to Sentry, best-effort. No-op when the
 * browser client was never initialized (NEXT_PUBLIC_SENTRY_DSN unset). Used for
 * API failures the UI handled (a real 5xx or a network / CORS error) so they
 * are observable in Sentry, not just swallowed by an inline message or toast.
 * Events pass through the same §10 beforeSend scrubber configured at init.
 */
export function reportClientError(
  error: unknown,
  tags?: Record<string, string>,
): void {
  if (!publicEnv.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/browser")
    .then((Sentry) =>
      Sentry.captureException(error, tags ? { tags } : undefined),
    )
    .catch(() => {
      /* observability must never break the app */
    });
}
