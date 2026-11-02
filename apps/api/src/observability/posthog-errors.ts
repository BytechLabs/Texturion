/**
 * Error tracking in PostHog (#652): every event the Worker's Sentry client has
 * already scrubbed is also sent to PostHog as a `$exception` event.
 *
 * It hangs off `beforeSend`, the one place every capture passes through
 * (`Sentry.captureException`, `captureMessage`, `opsAlert`, the Worker and
 * Durable Object wrappers). A second set of capture calls beside the sixty-odd
 * existing ones would drift from them, so there is none: PostHog gets exactly
 * the event Sentry gets, with the same scrubbers and the same fingerprints
 * (D139), and phase 2 deletes the Sentry half without touching a call site.
 *
 * The event is built from the SCRUBBED event, never the raw one. D8 allows
 * error events in PostHog on that condition and no other.
 */
import type { ErrorEvent } from "@sentry/cloudflare";

import type { Env } from "../env";
import { POSTHOG_CAPTURE_URL } from "../analytics/posthog";

/** Sentry's marker for "group this the usual way", which PostHog must not see. */
const DEFAULT_FINGERPRINT = "{{ default }}";

/** Anonymous identity for an error with no user: nothing here is a person. */
export const ERROR_DISTINCT_ID = "loonext-api";

/**
 * Under the SDK's 2s flush: `beforeSend` holds the Sentry event while this
 * runs, so a slow PostHog must not be able to cost the Sentry copy.
 */
const CAPTURE_TIMEOUT_MS = 1500;

/** A free-text field this long is a payload, not a message. */
const MAX_TEXT = 8_000;
const MAX_FRAMES = 100;

interface PostHogFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  platform: "node:javascript";
}

interface PostHogException {
  type: string;
  value: string;
  mechanism: { handled: boolean; type?: string; synthetic: boolean };
  stacktrace?: { type: "raw"; frames: PostHogFrame[] };
}

export interface PostHogExceptionEvent {
  event: "$exception";
  distinct_id: string;
  properties: Record<string, unknown>;
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/**
 * Our own grouping key, or undefined to let PostHog group by stack.
 *
 * `["ops", "telnyx-wiring"]` becomes `ops:telnyx-wiring`: the parts joined by a
 * colon, which no key contains. The rule is one line so the parity check
 * (tools/rig/src/posthog-errors.mjs) can apply it to a Sentry fingerprint.
 */
export function posthogFingerprint(
  fingerprint: readonly string[] | undefined,
): string | undefined {
  if (!fingerprint || fingerprint.length === 0) return undefined;
  if (fingerprint.every((part) => part === DEFAULT_FINGERPRINT)) return undefined;
  return fingerprint.join(":");
}

function framesOf(
  frames: readonly {
    filename?: string;
    abs_path?: string;
    function?: string;
    module?: string;
    lineno?: number;
    colno?: number;
    in_app?: boolean;
  }[],
): PostHogFrame[] {
  return frames.slice(-MAX_FRAMES).map((frame) => ({
    filename: frame.filename,
    abs_path: frame.abs_path,
    function: frame.function,
    module: frame.module,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    platform: "node:javascript",
  }));
}

function exceptionList(event: ErrorEvent): PostHogException[] {
  const values = event.exception?.values ?? [];
  if (values.length > 0) {
    return values.map((exception) => ({
      type: exception.type ?? "Error",
      value: clip(exception.value ?? ""),
      mechanism: {
        handled: exception.mechanism?.handled ?? true,
        type: exception.mechanism?.type,
        synthetic: false,
      },
      stacktrace: exception.stacktrace?.frames
        ? { type: "raw", frames: framesOf(exception.stacktrace.frames) }
        : undefined,
    }));
  }
  // captureMessage: there is no throw, so the message is the whole event. An
  // ops alert says so in its type, which is what the issue list shows.
  const message = event.message ?? event.logentry?.message ?? "";
  return [
    {
      type: event.tags?.ops_key !== undefined ? "OpsAlert" : "Message",
      value: clip(message),
      mechanism: { handled: true, synthetic: true },
    },
  ];
}

/**
 * Build the PostHog event for a scrubbed Sentry event, or null when there is
 * nothing to say.
 */
export function toPostHogException(
  event: ErrorEvent,
  env: Env,
): PostHogExceptionEvent | null {
  const list = exceptionList(event);
  if (list.every((entry) => entry.value === "" && entry.type === "Message")) {
    return null;
  }
  const id = event.user?.id;
  const properties: Record<string, unknown> = {
    $exception_list: list,
    $exception_level: event.level ?? "error",
    // An error is about the code, not a visitor: no person profile for it.
    $process_person_profile: false,
    $lib: "loonext-api",
    environment: event.environment,
    release: event.release ?? env.GIT_SHA,
    tags: event.tags,
    extra: event.extra,
    request_method: event.request?.method,
    request_url: event.request?.url,
  };
  const fingerprint = posthogFingerprint(event.fingerprint);
  if (fingerprint !== undefined) properties.$exception_fingerprint = fingerprint;
  if (event.tags?.ops_key !== undefined) properties.ops_key = event.tags.ops_key;
  return {
    event: "$exception",
    distinct_id:
      typeof id === "string" || typeof id === "number" ? String(id) : ERROR_DISTINCT_ID,
    properties,
  };
}

/**
 * Send one scrubbed event to PostHog. Resolves, never rejects: the error being
 * reported is the important thing and this is the copy. A failure is logged,
 * not captured, because a capture here would come straight back through
 * `beforeSend`.
 */
export async function mirrorToPostHog(
  env: Env,
  event: ErrorEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;
  try {
    const exception = toPostHogException(event, env);
    if (exception === null) return;
    const response = await fetchImpl(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.POSTHOG_API_KEY, ...exception }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`PostHog answered HTTP ${response.status}`);
    }
  } catch (cause) {
    console.error(
      "posthog error capture failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
