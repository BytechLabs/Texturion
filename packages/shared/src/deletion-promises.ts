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
 * What a workspace teardown does NOT reach, stated because #357 requires it:
 * *"A published page must not imply either is handled."*
 *
 * This is the section a vendor omits. Publishing it is the point — a page that
 * lists only what works is a page whose silence is the interesting part.
 *
 * #357 named two gaps and BOTH have since closed, which is why this list is
 * shorter than the issue implies and why it was worth checking rather than
 * copying: account deletion shipped (#346), and the marketing form's messages
 * got their own retention rather than a hook into the teardown (#340,
 * `api_prune_contact_messages`). Publishing the issue's version would have told
 * customers two things that stopped being true.
 *
 * So what remains is not a gap but a boundary, and it is still worth saying:
 * something held outside your workspace is not removed by closing your
 * workspace, and a reader deserves to know where to ask.
 */
export const DELETION_GAPS: readonly string[] = [
  "If you sent us a message through the contact form on our website, that is held outside any workspace, so closing one does not remove it. It is deleted on its own schedule after a year, and you can ask us to remove it sooner.",
];

/** The reversible window, in days. One number, quoted by every surface. */
export const DELETION_GRACE_DAYS = 30;
