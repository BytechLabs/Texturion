import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * Customer-facing registration/provisioning strings. The banner rows are the
 * SPEC §4.4 "Customer-facing states & copy" table — exact strings, verbatim;
 * the toast line is the DESIGN.md G7 approval toast. Shared by the status
 * banner, the /onboarding/setting-up checklist, and their tests so the copy
 * can never drift between surfaces.
 */

/**
 * #228: English is the DEFAULT here, not the only option.
 *
 * The sentences live in `i18n/sections/shell.ts`, in both languages, next to
 * the rest of the app frame — the status strip that says most of them is
 * mounted app-wide, above every page. What stays in this module is which line
 * a given state has earned, which is what `registration-ui-state.test.ts`
 * asserts with no provider in the room.
 *
 * Every function takes the reader's own `t` and falls back to English; the
 * plain constants resolve through English at import time, so a caller that has
 * not been converted yet reads exactly what it read before.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

export const REGISTRATION_COPY = {
  /** §4.4 "Number provisioning". */
  numberProvisioning: EN("shell.regNumberProvisioning"),
  /** A transient provision failure the cron is still retrying — honest, no false "nothing to do". */
  numberDelayed: EN("shell.regNumberDelayed"),
  /**
   * A number provision the retry loop can't fix (out of inventory / attempts) —
   * the honest, actionable line. {areaCode} interpolated when known.
   */
  numberActionNeeded: (areaCode: string | null, t: Translate = EN) =>
    areaCode
      ? t("shell.regNumberActionNeededAreaCode", { areaCode })
      : t("shell.regNumberActionNeeded"),
  /**
   * FEATURE-GAPS voice wave (not a §4.4 row): the only live number is a
   * keep-your-number text-enablement in carrier review — an honest multi-day
   * line, never the under-a-minute provisioning promise.
   */
  hostedReview: EN("shell.regHostedReview"),
  /** §4.4 "Registration submitted/pending". */
  registrationPending: EN("shell.regPending"),
  /** §4.4 "Sole-prop OTP outstanding" — {phone} interpolated. */
  otpPending: (phone: string, t: Translate = EN) =>
    t("shell.regOtpPending", { phone }),
  /** §4.4 "Rejected" — {rejection_reason} interpolated. */
  rejected: (reason: string, t: Translate = EN) =>
    t("shell.regRejected", { reason }),
  /** §4.4 "Approved". */
  approved: EN("shell.regApproved"),
  /** G7: the green toast fired on the approval realtime event. */
  approvedToast: EN("shell.regApprovedToast"),
  /** Unpaid company, viewed by a member (can't pay): nudge the owner. */
  setupUnfinishedMember: EN("shell.regSetupUnfinishedMember"),
  /** Canceled subscription: reads keep working, sending is off. */
  subscriptionCanceled: EN("shell.regSubscriptionCanceled"),
  /** past_due / unpaid: a failed payment paused outbound texting. */
  paymentIssue: EN("shell.regPaymentIssue"),
} as const;

/**
 * Progressive, honest "still setting up" copy for a number that is provisioning.
 * It de-escalates the "usually under a minute" promise as time passes, so a slow
 * setup is never a frozen lie. Tiered on (now - createdAt): <90s reads the
 * under-a-minute line (held ~30s past the 60s promise so we never contradict it
 * at the boundary), 90s–4min a calm "taking a little longer, hang tight", 4–10min
 * "you don't have to wait here." Past ~10min the BACKEND flips the row to
 * provision_failed (reason 'timeout') and the choose-a-number action takes over.
 * Pure + shared by the number card, the setting-up screen, and the status banner
 * so the copy can never drift; a missing/unparseable createdAt reads as tier 1.
 */
export function provisioningWaitCopy(
  createdAtIso: string | null | undefined,
  now: number,
  t: Translate = EN,
): string {
  const created = createdAtIso ? Date.parse(createdAtIso) : NaN;
  const elapsed = Number.isFinite(created) ? now - created : 0;
  if (elapsed >= 4 * 60_000) {
    return t("shell.regWaitLonger");
  }
  if (elapsed >= 90_000) {
    return t("shell.regWaitStill");
  }
  return t("shell.regNumberProvisioning");
}

/**
 * SPEC §4.1 step 4 checkout copy (verbatim, shown before payment) — rendered
 * as the honest-timeline card on the plan step (DESIGN.md G7 step 4).
 */
export const HONEST_TIMELINE = [
  EN("shell.regHonestTimelineReceiving"),
  EN("shell.regHonestTimelineCanada"),
  EN("shell.regHonestTimelineUs"),
] as const;

/** The CA-only variant: no US registration happens for this company. */
export const HONEST_TIMELINE_CA_ONLY = [
  HONEST_TIMELINE[0],
  HONEST_TIMELINE[1],
  EN("shell.regHonestTimelineUsOff"),
] as const;
