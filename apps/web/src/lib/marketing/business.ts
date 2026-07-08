/**
 * Business identity + trust facts, the single place ops fills in before launch.
 *
 * BLUEPRINT §9 / §14 blocker: the registered legal entity name and mailing
 * address are REQUIRED (CASL sender identification), must NOT be fabricated, and
 * must NOT be missing at launch. Since real values come from ops, they live here
 * as explicit nulls with a visible "pending" fallback the footer/contact/legal
 * pages render honestly, never an invented company name or street address.
 *
 * When ops supplies the real values, set them here once and every surface
 * (footer identity line, /contact, legal pages) updates together.
 */

/** Registered legal entity name, e.g. "Loonext Technologies Inc.", from ops. */
export const LEGAL_ENTITY_NAME: string | null = null;

/** Mailing address (single line), required for CASL identification, from ops. */
export const MAILING_ADDRESS: string | null = null;

/** Privacy officer name for Quebec Law 25 (BLUEPRINT §9), from ops. */
export const PRIVACY_OFFICER_NAME: string | null = null;

/** Support email, the only support channel (BLUEPRINT §2: no chat, no phone). */
export const SUPPORT_EMAIL = "support@loonext.com";

/** Responsible-disclosure contact for /security (SPEC §10). */
export const SECURITY_EMAIL = "security@loonext.com";

/** Privacy contact for /legal/privacy. */
export const PRIVACY_EMAIL = "privacy@loonext.com";

/**
 * Support-response expectation (BLUEPRINT §14). Phrased as a norm, not a hard
 * SLA: a solo-run support desk shouldn't publish a guarantee it can't always
 * honor, so "usually" keeps it honest and non-binding.
 */
export const SUPPORT_SLA = "We usually reply within one business day.";

/**
 * The footer/legal identity line. Returns the real entity + address once ops
 * fills them in; until then, null so callers render nothing (Law 1: never a
 * placeholder sentence, never an invented company).
 */
export function businessIdentityLine(): string | null {
  if (LEGAL_ENTITY_NAME && MAILING_ADDRESS) {
    return `${LEGAL_ENTITY_NAME} · ${MAILING_ADDRESS}`;
  }
  return null;
}

/** True once the real identity is in place (surfaces are honest either way). */
export const HAS_BUSINESS_IDENTITY =
  LEGAL_ENTITY_NAME !== null && MAILING_ADDRESS !== null;
