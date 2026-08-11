import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/** English, for a caller with no provider around it — the unit tests. */
const EN = makeTranslate(DEFAULT_LOCALE);

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

export function setupHeadline(
  input: SetupHeadlineInput,
  t: Translate = EN,
): string {
  // Waiting on the reader outranks the rest: a step that needs them must not
  // sit under a sentence saying everything is handled.
  if (input.aRowNeedsYou) return t("onboarding.setupNeedsYou");
  if (input.numberReady && input.everyRowDone) {
    return t("onboarding.setupAllLive");
  }
  if (input.numberReady) return t("onboarding.setupNumberReady");
  return t("onboarding.setupUpdatesItself");
}
