/**
 * Ops notices to PostHog, by the public project key alone: one POST to the
 * capture endpoint per event, which can only ingest (D146). The fingerprint is
 * `ops:<key>`, the grouping production's own notices use.
 */

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

/** The API Worker's phone and email patterns (apps/api/src/observability/scrub.ts). */
const PHONE = /(?<![0-9A-Za-z])(?:\+|%2[Bb])?1?\d{10,15}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** No phone number or email address leaves in a notice's text (D8). */
export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email redacted]").replace(PHONE, "[phone redacted]");
}

/** The edge's commit goes in `edge_sha`, not `release`, which names production's deploys. */
export interface EdgeEvent {
  /** `ops:<key>` for something production must see; anything else groups on its own. */
  fingerprint: string;
  message: string;
  level: "warning" | "error";
  environment: "production" | "synthetic";
  edgeSha?: string;
  properties?: Record<string, unknown>;
}

/** The capture body. */
export function buildCapture(projectKey: string, event: EdgeEvent, now: Date): string {
  return JSON.stringify({
    api_key: projectKey,
    event: "$exception",
    distinct_id: "loonext-rig-edge",
    timestamp: now.toISOString(),
    properties: {
      ...event.properties,
      $exception_list: [
        { type: "OpsNotice", value: scrubText(event.message), mechanism: { handled: true, synthetic: true } },
      ],
      $exception_level: event.level,
      $exception_fingerprint: event.fingerprint,
      $process_person_profile: false,
      environment: event.environment,
      source: "loonext-rig-edge",
      ...(event.edgeSha ? { edge_sha: event.edgeSha } : {}),
      ...(event.fingerprint.startsWith("ops:") ? { ops_key: event.fingerprint.slice(4) } : {}),
    },
  });
}

/** True when PostHog accepted the event. Never throws. */
export async function sendOpsEvent(projectKey: string | undefined, event: EdgeEvent): Promise<boolean> {
  const key = projectKey?.trim();
  if (!key) return false;
  try {
    const response = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildCapture(key, event, new Date()),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (cause) {
    console.warn(`posthog: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  }
}
