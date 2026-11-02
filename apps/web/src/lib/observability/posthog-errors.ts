/**
 * Error tracking in PostHog, browser side (#652). Browser twin of
 * apps/api/src/observability/posthog-errors.ts: every event the Sentry client
 * has already scrubbed is also captured in PostHog as a `$exception`.
 *
 * It rides the PostHog client the app already loads (lib/analytics/posthog.ts),
 * so the event passes that client's `sanitize_properties` a second time, and it
 * is identified as the same workspace UUID as the rest of the session. No
 * exception autocapture is switched on: only events that reached
 * `beforeSend`, after `scrubEvent`, are sent.
 */
import type { ErrorEvent } from "@sentry/browser";

import { initPostHog } from "@/lib/analytics/posthog";

const DEFAULT_FINGERPRINT = "{{ default }}";
const MAX_TEXT = 8_000;
const MAX_FRAMES = 100;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** Same rule as the Worker's: our own parts joined by a colon, else PostHog groups. */
export function posthogFingerprint(
  fingerprint: readonly string[] | undefined,
): string | undefined {
  if (!fingerprint || fingerprint.length === 0) return undefined;
  if (fingerprint.every((part) => part === DEFAULT_FINGERPRINT)) return undefined;
  return fingerprint.join(":");
}

/** The `$exception` properties for a scrubbed event, or null when it says nothing. */
export function toPostHogProperties(
  event: ErrorEvent,
): Record<string, unknown> | null {
  const values = event.exception?.values ?? [];
  const list =
    values.length > 0
      ? values.map((exception) => ({
          type: exception.type ?? "Error",
          value: clip(exception.value ?? ""),
          mechanism: {
            handled: exception.mechanism?.handled ?? true,
            type: exception.mechanism?.type,
            synthetic: false,
          },
          stacktrace: exception.stacktrace?.frames
            ? {
                type: "raw",
                frames: exception.stacktrace.frames.slice(-MAX_FRAMES).map((frame) => ({
                  filename: frame.filename,
                  abs_path: frame.abs_path,
                  function: frame.function,
                  module: frame.module,
                  lineno: frame.lineno,
                  colno: frame.colno,
                  in_app: frame.in_app,
                  platform: "web:javascript",
                })),
              }
            : undefined,
        }))
      : [
          {
            type: "Message",
            value: clip(event.message ?? event.logentry?.message ?? ""),
            mechanism: { handled: true, synthetic: true },
          },
        ];
  if (values.length === 0 && list[0]?.value === "") return null;

  const properties: Record<string, unknown> = {
    $exception_list: list,
    $exception_level: event.level ?? "error",
    $lib: "loonext-web",
    environment: event.environment,
    release: event.release,
    tags: event.tags,
    extra: event.extra,
  };
  const fingerprint = posthogFingerprint(event.fingerprint);
  if (fingerprint !== undefined) properties.$exception_fingerprint = fingerprint;
  return properties;
}

/**
 * Capture a scrubbed event in PostHog. Resolves, never rejects, and does
 * nothing when analytics is off (no NEXT_PUBLIC_POSTHOG_KEY).
 */
export async function mirrorToPostHog(event: ErrorEvent): Promise<void> {
  try {
    const properties = toPostHogProperties(event);
    if (properties === null) return;
    const posthog = await initPostHog();
    posthog?.capture("$exception", properties);
  } catch {
    /* observability must never break the app */
  }
}
