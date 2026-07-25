/**
 * The one test that decides whether an outgoing leg is OURS.
 *
 * Every leg this server dials — a member ring, a consult, a transfer target —
 * goes to a Telnyx CREDENTIAL URI (`sip:<user>@sip.telnyx.com`). A leg dialed
 * to a phone number is therefore never one of ours, whatever its `client_state`
 * says, because the softphone controls its own tag: a member holding a WebRTC
 * token can craft any tag they like and dial anywhere.
 *
 * So the gate trusts the DIAL TARGET, never the tag. An outgoing leg to a PSTN
 * number that reached a drop path bypassed the cap, subscription,
 * number-ownership and NANP checks, and must be hung up rather than dropped:
 * dropping leaves a live, billable channel connected that has no call row, no
 * ledger entry and no cap — the whole cost lands on the business.
 *
 * It lives in its own module because two separate paths need it — the webhook
 * router and the session Durable Object — and a test that only one of them
 * applies is a test that does not exist.
 */

/**
 * True when `to` is one of our own dialed legs (a Telnyx credential URI).
 *
 * Matched structurally rather than by substring, because both loose forms are
 * bypasses:
 *   - `sip:+15551234567@sip.telnyx.com` is a PSTN destination in a SIP costume,
 *     so a numeric user part never counts.
 *   - `sip:user@sip.telnyx.com.attacker.example` merely CONTAINS our host, so
 *     the host must match exactly, not be a prefix of something longer.
 * A trailing port or `;transport=` parameter is allowed, since Telnyx emits it.
 */
const OWN_CREDENTIAL_URI =
  /^sip:(?![+\d])[^@\s]+@sip\.telnyx\.com(?::\d+)?(?:;[^\s]*)?$/i;

export function isOwnDialedLeg(to: string | null | undefined): boolean {
  return OWN_CREDENTIAL_URI.test((to ?? "").trim());
}

/**
 * True when an outgoing `call.initiated` must be hung up instead of dropped:
 * it is going to a PSTN number, so it cannot be a leg we dialed, so nothing
 * authorized it.
 *
 * Inbound legs are never covered here — an incoming call is the customer
 * calling us, which is the product working.
 */
export function requiresUnauthorizedHangup(payload: {
  direction?: string | null;
  to?: string | null;
}): boolean {
  if (payload.direction !== "outgoing") return false;
  return !isOwnDialedLeg(payload.to);
}
