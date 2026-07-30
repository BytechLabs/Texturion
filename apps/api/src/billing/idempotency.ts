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

/**
 * A stable signature for a Checkout cart, for use as an idempotency
 * discriminator.
 *
 * #260: the checkout key used to be assembled from a hand-listed set of inputs
 * (plan + modules). The $29 US-registration line depends on none of them — it
 * depends on `country`, `us_texting_enabled` and `registration_fee_paid_at` —
 * and the first two are editable on the plan step between two attempts by
 * design. So a customer who changed their US answer sent the SAME key with
 * DIFFERENT parameters, Stripe answered `idempotency_error`, and checkout was
 * hard-blocked for roughly 24 hours with no way out: retrying reused the key,
 * and there was no other cart input they could change.
 *
 * Deriving the signature from the line items themselves fixes the class rather
 * than the instance. Any future line the cart grows is covered by construction,
 * because it changes the signature — nobody has to remember to add it here.
 *
 * Sorted, so two carts that differ only in the order lines were pushed collapse
 * to one session as they should. A metered line carries no quantity, hence the
 * `?? 1`: `undefined` and `1` must not read as different carts.
 */
export function cartSignature(
  lineItems: readonly { price?: string; quantity?: number }[],
): string {
  return lineItems
    .map((item) => `${item.price ?? "?"}x${item.quantity ?? 1}`)
    .slice()
    .sort()
    .join(",");
}
