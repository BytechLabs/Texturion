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

/**
 * The entity name and mailing address now live in `packages/shared` and are
 * re-exported here so every existing import keeps working (#312).
 *
 * They moved because the API Worker needs the same two values to print an address
 * in a commercial email footer, and holding the fact twice let the two disagree:
 * set one and the legal pages show an address while the email refuses to send;
 * set the other and the email carries an address the pages say we do not have.
 * Ops still sets them in exactly one file.
 */
import {LEGAL_ENTITY_NAME, MAILING_ADDRESS} from "@loonext/shared";

export { LEGAL_ENTITY_NAME, MAILING_ADDRESS } from "@loonext/shared";


/** Support email, the only support channel (BLUEPRINT §2: no chat, no phone). */
export const SUPPORT_EMAIL = "support@loonext.com";

/** Responsible-disclosure contact for /security (SPEC §10). */
export const SECURITY_EMAIL = "security@loonext.com";

/** Privacy contact for /legal/privacy. */
export const PRIVACY_EMAIL = "privacy@loonext.com";

export function businessIdentityLine(): string | null {
  return [LEGAL_ENTITY_NAME, MAILING_ADDRESS].filter(Boolean).join(" · ") || null;
}

/** True once the real identity is in place (surfaces are honest either way). */
export const HAS_BUSINESS_IDENTITY =
  LEGAL_ENTITY_NAME !== null && MAILING_ADDRESS !== null;
