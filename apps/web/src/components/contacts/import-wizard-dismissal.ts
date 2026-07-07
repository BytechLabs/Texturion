/**
 * Dismissal policy for the CSV import wizard dialog (issue #57).
 *
 * Invariant: a completed import's report is never silently lost. While the
 * POST /v1/contacts/import request is in flight, closing the dialog would
 * wipe the parsed rows and mapping that the done-step's skipped-rows CSV is
 * rebuilt from — so dismissal is blocked until the request settles, and the
 * wizard's state is only reset on a close that actually happens.
 */
export interface WizardDismissalDecision {
  /** Forward the open-state change to the parent (`onOpenChange`). */
  propagate: boolean;
  /** Wipe the wizard's parsed rows, mapping, and result before closing. */
  reset: boolean;
}

/**
 * Decide what a requested open-state change does.
 *
 * - Opening always propagates and never resets (state was reset on the last
 *   real close, or is mid-flight and must survive).
 * - Closing while the import request is in flight is swallowed entirely:
 *   the dialog stays open so the summary and skipped-rows report land in
 *   front of the user when the request settles.
 * - Closing otherwise propagates and resets the wizard for the next run.
 */
export function decideWizardDismissal(
  nextOpen: boolean,
  importPending: boolean,
): WizardDismissalDecision {
  if (nextOpen) return { propagate: true, reset: false };
  if (importPending) return { propagate: false, reset: false };
  return { propagate: true, reset: true };
}
