/**
 * Customer-facing registration/provisioning strings. The banner rows are the
 * SPEC §4.4 "Customer-facing states & copy" table — exact strings, verbatim;
 * the toast line is the DESIGN.md G7 approval toast. Shared by the status
 * banner, the /onboarding/setting-up checklist, and their tests so the copy
 * can never drift between surfaces.
 */
export const REGISTRATION_COPY = {
  /** §4.4 "Number provisioning". */
  numberProvisioning: "Setting up your business number, usually under a minute.",
  /** A transient provision failure the cron is still retrying — honest, no false "nothing to do". */
  numberDelayed:
    "We're still setting up your number. This is taking a little longer than usual.",
  /**
   * A number provision the retry loop can't fix (out of inventory / attempts) —
   * the honest, actionable line. {areaCode} interpolated when known.
   */
  numberActionNeeded: (areaCode: string | null) =>
    areaCode
      ? `We couldn't get a number in area code ${areaCode}. Choose another to finish setup.`
      : "We couldn't finish setting up your number. Choose a number to finish setup.",
  /**
   * FEATURE-GAPS voice wave (not a §4.4 row): the only live number is a
   * keep-your-number text-enablement in carrier review — an honest multi-day
   * line, never the under-a-minute provisioning promise.
   */
  hostedReview:
    "Text-enabling your existing number. Carrier review usually takes a few business days. Calls keep working the whole time.",
  /** §4.4 "Registration submitted/pending". */
  registrationPending:
    "US texting activates in ~3 to 7 business days (carrier approval). Receiving texts and texting Canadian numbers already work.",
  /** §4.4 "Sole-prop OTP outstanding" — {phone} interpolated. */
  otpPending: (phone: string) =>
    `One step left: enter the verification code we sent to ${phone} to finish US registration.`,
  /** §4.4 "Rejected" — {rejection_reason} interpolated. */
  rejected: (reason: string) =>
    `US registration needs a fix: ${reason}. Update and resubmit. It takes 2 minutes.`,
  /** §4.4 "Approved". */
  approved: "US texting is live.",
  /** G7: the green toast fired on the approval realtime event. */
  approvedToast: "You're live. US texting is on.",
  /** Unpaid company, viewed by a member (can't pay): nudge the owner. */
  setupUnfinishedMember:
    "Your workspace setup isn't finished yet. Ask your account owner to complete it.",
  /** Canceled subscription: reads keep working, sending is off. */
  subscriptionCanceled:
    "Your subscription is canceled. Outbound texting is off. Resubscribe to turn it back on.",
  /** past_due / unpaid: a failed payment paused outbound texting. */
  paymentIssue:
    "Payment didn't go through. Outbound texting is paused. Update your card to restore it.",
} as const;

/**
 * SPEC §4.1 step 4 checkout copy (verbatim, shown before payment) — rendered
 * as the honest-timeline card on the plan step (DESIGN.md G7 step 4).
 */
export const HONEST_TIMELINE = [
  "Receiving texts works the moment your number is ready (minutes).",
  "Texting Canadian numbers works immediately.",
  "Texting US numbers activates after carrier approval, typically 3 to 7 business days. We'll email you the moment you're approved.",
] as const;

/** The CA-only variant: no US registration happens for this company. */
export const HONEST_TIMELINE_CA_ONLY = [
  HONEST_TIMELINE[0],
  HONEST_TIMELINE[1],
  "US texting is off for your account. You can turn it on any time in Settings.",
] as const;
