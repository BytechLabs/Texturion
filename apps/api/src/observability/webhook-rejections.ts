/**
 * #308 — counting the webhooks we receive and throw away.
 *
 * All three webhook routes return 400 on a bad signature and record nothing:
 * `webhooks/telnyx.ts`, `webhooks/resend.ts`, `webhooks/stripe.ts`. So the
 * rotated-secret failure produces **no signal on either side** — the provider
 * believes it is delivering, and we believe nothing is arriving. That is worse
 * than the webhook stopping, and it is invisible to Sentry because nothing
 * throws: a rejection is a `return`, not an exception.
 *
 * Deliberately its own module rather than living in `liveness-check.ts`. That
 * file imports the email sender, and this is called from an unauthenticated
 * public route on the hottest path in the product — the route has no business
 * pulling the alerting stack in behind it. Same split, and the same reason, as
 * `liveness.ts` vs `liveness-check.ts`.
 */
import type { Context } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";

export type WebhookProvider = "telnyx" | "stripe" | "resend";

/**
 * The header that means "a provider tried to deliver this", per provider.
 *
 * A rejection is only counted when its request carries this, and the check is
 * doing two jobs:
 *
 *   1. **It bounds the write path.** These routes are public and
 *      unauthenticated — the signature IS the authentication — so a scanner
 *      POSTing junk must not be able to drive a database write per request.
 *   2. **It is more accurate.** A random POST is not evidence about our
 *      secret. Counting it would dilute the one signal this exists to produce:
 *      real deliveries, correctly signed by the provider, that we are
 *      refusing. A rejection carrying a well-formed signature header is
 *      exactly the rotated-secret shape and nothing else looks like it.
 */
const SIGNATURE_HEADER: Record<WebhookProvider, string> = {
  telnyx: "telnyx-signature-ed25519",
  stripe: "stripe-signature",
  // Resend signs via svix.
  resend: "svix-signature",
};

/**
 * Count one signature rejection, if the request looks like a real delivery.
 *
 * NEVER THROWS. This runs on the failure path of a webhook that is already
 * being refused; a counter that could turn a 400 into a 500 would make the
 * provider retry a request we will never accept, which is strictly worse than
 * losing the count. The absence of the count is itself observable one cadence
 * later — the mechanism working, not a hole in it.
 */
export async function recordWebhookRejection(
  env: Env,
  request: Request,
  provider: WebhookProvider,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  if (!request.headers.get(SIGNATURE_HEADER[provider])) return;
  try {
    const { error } = await db.rpc("record_webhook_rejection", {
      p_provider: provider,
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    console.error(
      `liveness: ${provider} webhook rejection failed to record: ${String(cause)}`,
    );
  }
}

/**
 * Count the rejection off the response path, from inside a route handler.
 *
 * The guard around `executionCtx` is not defensive padding — it is the exact
 * hazard this module's contract is about. `c.executionCtx` THROWS when no
 * execution context is bound to the request, so reaching for it on a failure
 * path turns the 400 into a 500, and a 500 makes the provider retry a request
 * we are never going to accept. That is strictly worse than losing the count,
 * which the checker notices one cadence later anyway.
 *
 * Every rejection site goes through here rather than calling `waitUntil`
 * itself, so the guard cannot be omitted by the next person who adds a
 * provider.
 */
export function countWebhookRejection(
  c: Context<AppEnv>,
  provider: WebhookProvider,
): void {
  const work = recordWebhookRejection(getEnv(c.env), c.req.raw, provider);
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context bound (unit dispatch, or a non-Worker host). The
    // promise is already running and cannot throw; it simply may not be
    // awaited. Nothing to report — reporting here would be noise on a path
    // that is already returning an error.
  }
}
