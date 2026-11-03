/**
 * #308: the webhooks we receive and throw away.
 *
 * All three webhook routes return 400 on a bad signature, so a rotated secret
 * produces no error on either side: the provider believes it is delivering and
 * nothing here throws. Each refusal becomes a `webhook_rejected` event, and
 * PostHog's "Limits and rates" alert fires on three from one provider in an
 * hour (D146).
 *
 * The routes are public and any non-empty signature header passes the check
 * below, so sending is capped at one event per provider every five minutes per
 * isolate. Without that, one script could spend the month's event quota, and
 * the free plan stops ingesting errors and heartbeats with it.
 */
import type { Context } from "hono";

import type { AppEnv } from "../context";
import { getEnv } from "../env";
import { captureEvent, SYSTEM_DISTINCT_ID } from "./capture";
import { rateGate } from "./rate-gate";

export type WebhookProvider = "telnyx" | "stripe" | "resend";

/**
 * The header that means "a provider tried to deliver this", per provider.
 *
 * These routes are public, so a scanner POSTing junk must not be able to send
 * an event per request, and a random POST says nothing about our secret. A
 * refused request carrying a well-formed signature header is the
 * rotated-secret shape and nothing else looks like it.
 */
const SIGNATURE_HEADER: Record<WebhookProvider, string> = {
  telnyx: "telnyx-signature-ed25519",
  stripe: "stripe-signature",
  // Resend signs via svix.
  resend: "svix-signature",
};

/** The alert needs three rejections in an hour, which is three windows, not three requests. */
const REJECTION_WINDOW_MS = 5 * 60 * 1000;

export const rejectionGate = rateGate(REJECTION_WINDOW_MS);

/**
 * Report one signature rejection off the response path. Never throws: a 500
 * here would make the provider retry a request we will never accept.
 *
 * `c.executionCtx` itself throws when no execution context is bound, which is
 * why the lookup is guarded rather than left to the caller.
 */
export function countWebhookRejection(
  c: Context<AppEnv>,
  provider: WebhookProvider,
): void {
  if (!c.req.raw.headers.get(SIGNATURE_HEADER[provider])) return;
  if (!rejectionGate.allow(provider)) return;
  let waitUntil: (promise: Promise<unknown>) => void;
  try {
    const ctx = c.executionCtx;
    waitUntil = (promise) => ctx.waitUntil(promise);
  } catch {
    waitUntil = () => {};
  }
  try {
    void captureEvent(
      getEnv(c.env),
      "webhook_rejected",
      SYSTEM_DISTINCT_ID,
      { provider },
      waitUntil,
    );
  } catch (cause) {
    console.error(`${provider} webhook rejection was not reported: ${String(cause)}`);
  }
}
