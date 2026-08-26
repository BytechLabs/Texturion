/**
 * #357 — what we tell a customer about deletion, in one place.
 *
 * `docs/DELETION.md` (D48) is the strongest trust artifact this company has
 * produced, and it lives in a repository. It says plainly that *"total erasure
 * is not available to us, and a deletion feature that claims it is lying"*, and
 * it explains why a STOP outlives the workspace that received it. A prospect
 * evaluating us cannot read any of that.
 *
 * #357's third point is the one that decided this module's shape: *"'We keep
 * your STOP list forever' sounds alarming stripped of its reasoning and
 * entirely reassuring with it."* So every survival carries its reason in the
 * same string, and there is no way to render one without the other.
 *
 * WHY SHARED RATHER THAN A PAGE. D48 already requires the emails, the
 * confirmation screens and the public page to say the same thing —
 * *"so the emails, the confirmation screens and the public page cannot drift
 * into three different promises."* A published page written separately from the
 * emails is that drift, on the one document where a mismatch reads as
 * dishonesty rather than staleness. #285's questionnaire answers come from here
 * too, rather than being written from scratch under deal pressure.
 */

/**
 * Boundaries a workspace teardown cannot cross.
 *
 * These are stable identifiers, not copy: each public surface supplies the
 * reader's language for every id. Keeping the inventory here prevents a page,
 * email or questionnaire from silently omitting a boundary while still letting
 * the wording be translated.
 */
export const DELETION_GAPS = ["contact_form_message"] as const;
export type DeletionGap = (typeof DELETION_GAPS)[number];

/** The reversible window, in days. One number, quoted by every surface. */
export const DELETION_GRACE_DAYS = 30;
