/**
 * #312 — the consent wording, alone in a module with no imports.
 *
 * Split out of the form component for the same reason `contact-form-logic.ts` is
 * split out of `contact-form.tsx`: the component imports `publicEnv`, which
 * validates the browser environment at import time, so a node-runner test that
 * only wants a string cannot load it.
 *
 * The string itself has to be testable, because the record of what somebody agreed
 * to is only evidence if it matches what they were shown.
 */

/**
 * The exact words shown beside the consent checkbox.
 *
 * MUST equal `MARKETING_CONSENT_TEXT` in
 * `apps/api/src/marketing/comparison-email.ts`, which is what the server
 * snapshots onto the consent row. The server keeps its own copy and ignores
 * anything the client sends, because a client that could supply the wording could
 * record any agreement it liked — so these are two constants bound by a test
 * rather than one import across a boundary that does not exist.
 */
export const CONSENT_LABEL =
  "Email me this comparison. I understand Loonext may email me about the " +
  "product, and I can unsubscribe from any message.";
