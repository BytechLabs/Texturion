/**
 * The stable-key convention behind the §2/§9 double-charge fail-safes.
 *
 * stripe-node's own `maxNetworkRetries` auto-key only dedupes the transport
 * retries of a SINGLE call — it never collapses two DISTINCT HTTP requests (two
 * concurrent clicks, a webhook racing a route). To make Stripe REPLAY the first
 * charge instead of billing twice, the `Idempotency-Key` must be DERIVED from
 * the company + intent (+ any cart discriminator), so two concurrent identical
 * requests compute the SAME key — never `crypto.randomUUID()` per request.
 *
 * Genuinely different intents (a different plan/module set) get a different key
 * and are correctly allowed to create distinct objects. Stripe keys expire after
 * ~24h, so a legitimate later retry of the same intent is a fresh charge, not a
 * stale replay.
 *
 *   idempotencyKey(companyId, "checkout", plan, modules.sort().join(","))
 *   idempotencyKey(companyId, "us_registration_fee")
 */
export function idempotencyKey(
  companyId: string,
  intent: string,
  ...discriminators: string[]
): string {
  return [companyId, intent, ...discriminators].join(":");
}
