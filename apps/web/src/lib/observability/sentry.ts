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
import type { BrowserOptions, ErrorEvent, EventHint } from "@sentry/browser";

import { whenTelemetryMayLoad } from "@/lib/perf/telemetry-gate";
import { clientEnv } from "@/public-env";

import type * as SentrySdkModule from "./sentry-sdk";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

/** Enough to see a boot failure, not enough to flood the project. */
const MAX_EARLY_ERRORS = 10;

type SentrySdk = typeof SentrySdkModule;

/** An uncaught error or rejection seen before the SDK was up. */
interface HeldError {
  error: unknown;
  hint: EventHint;
}

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

let client: Promise<SentrySdk | null> | null = null;

/**
 * Idempotent, best-effort init. Resolves (never rejects) with the SDK once it
 * is running, or null when it is configured off or failed to load. A failed
 * SDK load must never break page boot.
 *
 * On a marketing page the SDK downloads only once the page has settled
 * (#640): fetched with the page, it joined the LCP that Lighthouse simulates.
 * Errors thrown before then are held and reported once the SDK is up.
 */
export function initSentryClient(): Promise<SentrySdk | null> {
  const dsn = clientEnv.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return Promise.resolve(null); // observability off — silent no-op
  if (client) return client;
  const early = holdEarlyErrors();
  client = whenTelemetryMayLoad()
    .then(() => import("./sentry-sdk"))
    .then((sdk) => {
      sdk.init(sentryClientOptions(dsn));
      early.report(sdk.captureException);
      return sdk;
    })
    .catch((cause: unknown) => {
      early.drop();
      console.error("Sentry browser init failed:", cause);
      return null;
    });
  return client;
}

/**
 * Catches uncaught errors and unhandled rejections until the SDK installs its
 * own handlers, which is what `init` used to do at once. Each is reported
 * with the mechanism those handlers use, so it still counts as unhandled.
 */
function holdEarlyErrors(): {
  report: (capture: (error: unknown, hint: EventHint) => unknown) => void;
  drop: () => void;
} {
  const held: HeldError[] = [];
  const hold = (item: HeldError) => {
    if (held.length < MAX_EARLY_ERRORS) held.push(item);
  };
  const onError = (event: WindowEventMap["error"]) =>
    hold({
      error: event.error ?? event.message,
      hint: {
        originalException: event.error,
        mechanism: {
          type: "auto.browser.global_handlers.onerror",
          handled: false,
          // A cross-origin script error has no error object; keep where it was.
          ...(event.error
            ? {}
            : {
                data: {
                  filename: event.filename,
                  lineno: String(event.lineno),
                  colno: String(event.colno),
                },
              }),
        },
      },
    });
  const onRejection = (event: PromiseRejectionEvent) =>
    hold({
      error: event.reason,
      hint: {
        originalException: event.reason,
        mechanism: {
          type: "auto.browser.global_handlers.onunhandledrejection",
          handled: false,
        },
      },
    });
  if (typeof window !== "undefined") {
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
  }
  const drop = () => {
    if (typeof window === "undefined") return;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
  return {
    report(capture) {
      drop();
      for (const { error, hint } of held.splice(0)) capture(error, hint);
    },
    drop,
  };
}

/**
 * Report an unexpected client-side error to Sentry, best-effort. No-op when
 * NEXT_PUBLIC_SENTRY_DSN is unset. Used for API failures the UI handled (a
 * real 5xx or a network / CORS error) so they are observable in Sentry, not
 * just swallowed by an inline message or toast. An error reported before the
 * SDK is up waits for it. Events pass through the same §10 beforeSend
 * scrubber configured at init.
 */
export function reportClientError(
  error: unknown,
  tags?: Record<string, string>,
): void {
  void initSentryClient()
    .then((sdk) => sdk?.captureException(error, tags ? { tags } : undefined))
    .catch(() => {
      /* observability must never break the app */
    });
}
