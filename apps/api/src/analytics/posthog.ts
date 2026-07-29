/**
 * PostHog product analytics (SPEC §12 step 18): ONE capture helper for the
 * north-star funnel events — checkout_completed, first_outbound_sent,
 * registration_submitted, registration_approved.
 *
 * distinct_id is ALWAYS the company_id — never a person, never PII (SPEC §10:
 * no message bodies, emails, or phone numbers in third-party telemetry).
 *
 * #418: that sentence used to be a PREMISE — true of `distinct_id`, which the
 * signature guarantees, and merely hoped for of `properties`, which was typed
 * `Record<string, unknown>` and checked by nobody. Every caller happened to
 * pass an enumeration (`{ plan }`, `{ action }`), so the claim held; nothing
 * made it hold. A load-bearing claim about what leaves for a third party
 * should be enforced by something other than the next author's care, so
 * `scrubProperties` below now enforces it.
 * POSTHOG_API_KEY is OPTIONAL: unset (local dev, tests) makes every capture a
 * silent no-op. Captures are best-effort — a PostHog outage or bad response
 * must never break the send/webhook path that fired the event, so failures
 * are swallowed (console + Sentry breadcrumb only).
 */
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "../env";

/** PostHog Cloud (US) capture endpoint. */
export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";

/**
 * The shapes SPEC §10 forbids in third-party telemetry (#418).
 *
 * Deliberately shape-based rather than key-based. A key-name blocklist
 * ("phone", "email") catches the careless author and misses the one who writes
 * `{ contact: "+16135551234" }` — and the careless author is not the one this
 * guard is for. What matters is what the VALUE is, not what it was called.
 */
const FORBIDDEN: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  // E.164 and the loose North American forms people actually type. Anchored
  // loosely on purpose: a phone number embedded in a longer string is still a
  // phone number arriving at PostHog.
  { what: "phone number", pattern: /\+?\d[\d\s().-]{8,}\d/ },
  { what: "email address", pattern: /[^\s@]+@[^\s@]+\.[^\s@]{2,}/ },
];

/**
 * Prose has words; an enumeration does not.
 *
 * A length cap alone is the wrong instrument — it is arbitrary, and a short
 * message ("pipe burst at 42 Elm") slips under any cap generous enough to
 * allow a legitimate value. What actually separates the two is that every
 * property this codebase sends is a single token: `"pro"`, `"starter"`,
 * `"submitted"`, `"first_outbound_sent"`. Four or more words is a sentence,
 * and a sentence is a thing a person wrote.
 *
 * The length cap stays as a second net, for the one-token value long enough to
 * be an identifier of some kind.
 */
const MAX_PROPERTY_WORDS = 3;
const MAX_PROPERTY_LENGTH = 64;

/**
 * Drop anything that looks like a person, and say so loudly.
 *
 * DROPS RATHER THAN THROWS. Telemetry must never break the send or webhook
 * path that fired the event — that rule predates this guard and outranks it.
 * But a silent drop would make this guard the thing that hides the bug, so the
 * offending KEY (never the value) goes to Sentry, which is where somebody will
 * see it.
 */
export function scrubProperties(
  event: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string") {
      // Numbers and booleans cannot carry a body, an address or a name.
      safe[key] = value;
      continue;
    }
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    const offence =
      words > MAX_PROPERTY_WORDS || value.length > MAX_PROPERTY_LENGTH
        ? "free text"
        : FORBIDDEN.find((rule) => rule.pattern.test(value))?.what;
    if (offence === undefined) {
      safe[key] = value;
      continue;
    }
    // The message names the key and the offence, never the value — reporting a
    // leak by repeating it into a different third party would be worse than
    // the leak.
    const message =
      `posthog capture '${event}': dropped property '${key}' — it looks like ` +
      `a ${offence}, and SPEC §10 keeps those out of third-party telemetry`;
    console.error(message);
    Sentry.captureMessage(message, "warning");
  }
  return safe;
}

/**
 * Capture one product event keyed on the company. Resolves (never rejects)
 * whether the capture succeeded, failed, or analytics is off — callers may
 * await it without any error handling of their own.
 */
export async function capture(
  env: Env,
  event: string,
  companyId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return; // analytics off — silent no-op

  try {
    const response = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event,
        distinct_id: companyId,
        properties: scrubProperties(event, properties),
      }),
      // Analytics must never stall a send or a webhook: cap the round-trip.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`PostHog answered HTTP ${response.status}`);
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`posthog capture '${event}' failed:`, detail);
    Sentry.addBreadcrumb({
      category: "analytics",
      message: `posthog capture '${event}' failed: ${detail}`,
      level: "warning",
    });
  }
}
