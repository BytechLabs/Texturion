/**
 * Server-side error tracking for the web Worker (D146): every error a server
 * render, route handler or server action throws reaches Next's
 * `onRequestError` (src/instrumentation.ts), and this sends it to PostHog.
 *
 * Scrubbed before the SDK sees it, like the API Worker's capture: the error is
 * rebuilt from its scrubbed message and stack, and only the route PATTERN is
 * kept, never the requested path, which can carry a token or a search term.
 */
// The fetch-only build: the Worker runs it under workerd, whatever the bundler picks.
import { PostHog } from "posthog-node/edge";

import { POSTHOG_HOST } from "@/lib/analytics/posthog";
import { clientEnv } from "@/public-env";

import { scrubText, scrubUnknown } from "./scrub";

/** Identity for errors about the code rather than a visitor. */
export const WEB_DISTINCT_ID = "loonext-web";

/** A cause chain this deep is a loop, not a diagnosis. */
const MAX_CAUSES = 5;

/** What Next hands `onRequestError` about where the error happened. */
export interface RequestErrorContext {
  routerKind: string;
  routePath: string;
  routeType: string;
}

/** A copy of the thrown value that carries only scrubbed text. */
export function scrubbedError(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) {
    return typeof value === "string" ? scrubText(value) : scrubUnknown(value);
  }
  const copy = new Error(scrubText(value.message));
  copy.name = value.name;
  copy.stack = value.stack === undefined ? undefined : scrubText(value.stack);
  if (value.cause !== undefined && depth < MAX_CAUSES) {
    copy.cause = scrubbedError(value.cause, depth + 1);
  }
  return copy;
}

/**
 * Send one server error. Resolves, never rejects, and does nothing when
 * NEXT_PUBLIC_POSTHOG_KEY is unset.
 */
export async function captureServerError(
  error: unknown,
  method: string,
  context: RequestErrorContext,
): Promise<void> {
  const key = clientEnv.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;
  const posthog = new PostHog(key, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 3000,
    fetchRetryCount: 1,
    disableGeoip: true,
    disableCompression: true,
    before_send: (event) =>
      event.event === "$exception"
        ? {
            ...event,
            properties: scrubUnknown(event.properties) as typeof event.properties,
          }
        : event,
  });
  try {
    await posthog.captureExceptionImmediate(scrubbedError(error), WEB_DISTINCT_ID, {
      environment: clientEnv.NEXT_PUBLIC_DEPLOY_ENV ?? "local",
      release: process.env.NEXT_PUBLIC_APP_VERSION,
      source: "web-server",
      route: context.routePath,
      route_type: context.routeType,
      router: context.routerKind,
      method,
      $process_person_profile: false,
      ...(digest === undefined ? {} : { digest }),
    });
  } catch (cause) {
    console.error(
      "posthog server error capture failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
