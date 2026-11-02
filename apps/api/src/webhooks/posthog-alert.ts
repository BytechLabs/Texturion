import { Hono } from "hono";

import type { AppEnv } from "../context";
import { getEnv } from "../env";
import { relayPostHogAlert, type RelayedAlert } from "../observability/ops-alert";

/**
 * #652: where PostHog's error-tracking alerts land.
 *
 * PostHog raises `$error_tracking_issue_created` and
 * `$error_tracking_issue_reopened` and posts each to a webhook destination.
 * This is that destination, so no Slack or Discord URL belongs to anybody
 * else: the alert becomes an ops email to the founder (`ops-alert.ts`), at most
 * one per fingerprint per hour.
 *
 * PostHog does not sign a webhook unless a signing secret is set, so the
 * request carries a shared secret in a header instead (the destination's
 * `secret_headers` input, stored encrypted on PostHog's side). Mounted at
 * /webhooks/posthog-alert: outside the JWT chain, never CORS.
 */
export const posthogAlertWebhookRoute = new Hono<AppEnv>();

/** The header PostHog's destination sends the shared secret in. */
export const OPS_SECRET_HEADER = "x-loonext-ops-secret";

/** A PostHog alert body is a few kilobytes; anything near this is not one. */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2_000;

const HANDLED_EVENTS = new Set([
  "$error_tracking_issue_created",
  "$error_tracking_issue_reopened",
]);

/**
 * Compare through SHA-256 so neither the length nor the first differing byte
 * of the real secret shows in how long the answer takes.
 */
async function secretMatches(given: string | undefined, expected: string): Promise<boolean> {
  if (!given) return false;
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Only a link into PostHog itself is worth putting in the mail. */
function posthogLink(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const ours = host === "posthog.com" || host.endsWith(".posthog.com");
    return url.protocol === "https:" && ours ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the webhook template's default body: `{ event, person }`, where `event`
 * carries `event`, `distinct_id` (the issue id), `url` and `properties`
 * (`name`, `description`, `status`, `fingerprint`, ...).
 *
 * Returns `ignored` for an event this endpoint has no use for and `null` for a
 * body that is not an alert at all.
 */
export function parsePostHogAlert(body: unknown): RelayedAlert | "ignored" | null {
  if (typeof body !== "object" || body === null) return null;
  const event = (body as { event?: unknown }).event;
  if (typeof event !== "object" || event === null) return null;
  const { event: name, distinct_id, properties, url } = event as {
    event?: unknown;
    distinct_id?: unknown;
    properties?: unknown;
    url?: unknown;
  };
  if (typeof name !== "string") return null;
  if (!HANDLED_EVENTS.has(name)) return "ignored";

  const props =
    typeof properties === "object" && properties !== null
      ? (properties as Record<string, unknown>)
      : {};
  // PostHog groups an ops alert under our own `$exception_fingerprint`; the
  // issue id is the fallback for an error it grouped from the stack.
  const fingerprint =
    text(props.fingerprint) ?? text(props.$exception_fingerprint) ?? text(distinct_id);
  if (!fingerprint) return null;

  const title = (text(props.name) ?? "Error issue").replace(/\s+/g, " ").trim();
  const description = text(props.description);
  const status = text(props.status);
  return {
    fingerprint: clip(fingerprint, 300),
    title: clip(title, MAX_TITLE),
    description: description ? clip(description, MAX_DESCRIPTION) : undefined,
    status: status ? clip(status, 40) : undefined,
    event: name,
    link: posthogLink(url),
  };
}

posthogAlertWebhookRoute.post("/", async (c) => {
  const env = getEnv(c.env);

  // An unset secret must never mean "accept anything": anybody could then make
  // the founder's inbox say whatever they liked.
  if (!env.OPS_ALERT_WEBHOOK_SECRET) {
    return c.json({ error: "posthog alerts are not configured" }, 503);
  }
  if (!(await secretMatches(c.req.header(OPS_SECRET_HEADER), env.OPS_ALERT_WEBHOOK_SECRET))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: "payload too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "malformed payload" }, 400);
  }

  const alert = parsePostHogAlert(body);
  if (alert === null) return c.json({ error: "not a PostHog alert" }, 422);
  if (alert === "ignored") return c.json({ received: true, delivery: "ignored" }, 202);

  try {
    const delivery = await relayPostHogAlert(env, alert);
    if (delivery === "unconfigured") {
      return c.json({ error: "no ops recipient is configured" }, 503);
    }
    return c.json({ received: true, delivery });
  } catch (cause) {
    // A non-2xx makes PostHog retry, and the slot was handed back.
    console.error(
      "posthog alert relay: email failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
    return c.json({ error: "could not deliver the alert" }, 502);
  }
});
