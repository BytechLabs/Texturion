/**
 * The status line under the setting-up heading. Pure so the claim it makes can
 * be pinned against the rows below it: the number landing is only the first of
 * three checklist rows, and carrier registration keeps running for days after
 * it, so readiness has to be read from every row rather than from the number
 * alone.
 */
export interface SetupHeadlineInput {
  /** A live number exists, so the heading has flipped to the reveal. */
  numberReady: boolean;
  /** Every checklist row reads done. */
  everyRowDone: boolean;
  /** A row is waiting on the reader (number choice, port action, or the OTP). */
  aRowNeedsYou: boolean;
}

export function setupHeadline(input: SetupHeadlineInput): string {
  // Waiting on the reader outranks the rest: a step that needs them must not
  // sit under a sentence saying everything is handled.
  if (input.aRowNeedsYou) {
    return "One step below needs you. The rest updates itself.";
  }
  if (input.numberReady && input.everyRowDone) {
    return "Everything below is live. Text your new number to see it land.";
  }
  if (input.numberReady) {
    return "Text your new number to see it land. One step below is still finishing.";
  }
  return "This screen updates itself. No refreshing needed.";
}
