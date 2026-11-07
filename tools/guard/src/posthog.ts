import type { Ctx } from "./context";

/**
 * Production ops notices, sent to PostHog's capture endpoint with the public
 * project key only (D146). The fingerprint is `ops:<key>`, the same grouping
 * `apps/api/src/observability/capture.ts` uses, so one problem is one
 * production issue whichever Worker raised it.
 */
export interface ProductionEvent {
  key: string;
  summary: string;
  detail?: string;
  level?: "warning" | "error";
}

export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";

/** The API Worker's phone and email patterns (apps/api/src/observability/scrub.ts). */
const PHONE = /(?<![0-9A-Za-z])(?:\+|%2[Bb])?1?\d{10,15}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** No phone number or email address leaves in a notice's text (D8). */
export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email redacted]").replace(PHONE, "[phone redacted]");
}

/** The `$exception` body PostHog groups into one issue per key. */
export function buildCapture(projectKey: string, event: ProductionEvent, now: number): string {
  return JSON.stringify({
    api_key: projectKey,
    event: "$exception",
    distinct_id: "loonext-telnyx-guard",
    timestamp: new Date(now).toISOString(),
    properties: {
      $exception_list: [
        { type: "OpsNotice", value: scrubText(event.summary), mechanism: { handled: true, synthetic: true } },
      ],
      $exception_level: event.level ?? "warning",
      $exception_fingerprint: `ops:${event.key}`,
      $process_person_profile: false,
      ops_key: event.key,
      source: "loonext-telnyx-guard",
      environment: "production",
      ...(event.detail ? { detail: scrubText(event.detail) } : {}),
    },
  });
}

/**
 * Best effort, and never thrown: this runs inside refusals and crons, where a
 * failed notice must not become a second failure. Returns whether PostHog
 * accepted it.
 */
export async function sendProductionEvent(ctx: Ctx, event: ProductionEvent): Promise<boolean> {
  const projectKey = ctx.config.posthogProjectKey;
  if (!projectKey) {
    console.error(`guard: production event ${event.key} not sent: POSTHOG_PROJECT_KEY unset`);
    return false;
  }
  try {
    const response = await ctx.fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildCapture(projectKey, event, ctx.now()),
    });
    await response.body?.cancel();
    if (!response.ok) console.error(`guard: production event ${event.key}: PostHog answered ${response.status}`);
    return response.ok;
  } catch (cause) {
    console.error(
      `guard: production event ${event.key} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return false;
  }
}
