/**
 * The registered legal entity name and mailing address — ONE fact, in the one
 * place both runtimes can read it.
 *
 * These were already declared as explicit nulls in
 * `apps/web/src/lib/marketing/business.ts`, awaiting ops, with a visible pending
 * fallback so the footer and legal pages render honestly rather than inventing a
 * company or a street address. That posture is right and unchanged; this file only
 * moves the two values somewhere the API Worker can see them too.
 *
 * WHY THAT MATTERS (#312). A commercial email has to carry a real mailing
 * address, and the Worker is what sends it. Holding the same fact twice — a web
 * constant and a Worker env var — meant the two could disagree: set one and the
 * legal pages show an address while the email refuses to send; set the other and
 * the email carries an address the pages say we do not have. Both are silent
 * inconsistencies on a compliance-adjacent surface, which is the failure class
 * worth designing out rather than commenting about.
 *
 * NOT A SECRET, so a constant rather than config is right: a business mailing
 * address is printed in email footers and legal pages by definition. It is
 * public information that happens to be missing.
 *
 * When ops supplies the real values, set them HERE once. The footer identity
 * line, /contact, the legal pages and the commercial email footer all start
 * working together, and `hasBusinessIdentity()` stops gating them.
 */

/** Registered legal entity name, e.g. "Loonext Technologies Inc.", from ops. */
export const LEGAL_ENTITY_NAME: string | null = null;

/** Mailing address (single line), required for sender identification, from ops. */
export const MAILING_ADDRESS: string | null = null;

/**
 * True once the real identity is in place. Every surface stays honest either
 * way: one that cannot be honest without it declines to render rather than
 * printing a placeholder.
 */
export function hasBusinessIdentity(): boolean {
  return LEGAL_ENTITY_NAME !== null && MAILING_ADDRESS !== null;
}
