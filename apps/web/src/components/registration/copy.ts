/**
 * Customer-facing registration/provisioning strings. The banner rows are the
 * SPEC §4.4 "Customer-facing states & copy" table — exact strings, verbatim;
 * the toast line is the DESIGN.md G7 approval toast. Shared by the status
 * banner, the /onboarding/setting-up checklist, and their tests so the copy
 * can never drift between surfaces.
 */
export const REGISTRATION_COPY = {
  /** §4.4 "Number provisioning". */
  numberProvisioning: "Setting up your business number — usually under a minute.",
  /** §4.4 "Provisioning delayed/failed (internal)". */
  numberDelayed:
    "We're setting up your number — this is taking longer than usual. You don't need to do anything.",
  /**
   * FEATURE-GAPS voice wave (not a §4.4 row): the only live number is a
   * keep-your-number text-enablement in carrier review — an honest multi-day
   * line, never the under-a-minute provisioning promise.
   */
  hostedReview:
    "Text-enabling your existing number — carrier review usually takes a few business days. Calls keep working the whole time.",
  /** §4.4 "Registration submitted/pending". */
  registrationPending:
    "US texting activates in ~3–7 business days (carrier approval). Receiving texts and texting Canadian numbers already work.",
  /** §4.4 "Sole-prop OTP outstanding" — {phone} interpolated. */
  otpPending: (phone: string) =>
    `One step left: enter the verification code we sent to ${phone} to finish US registration.`,
  /** §4.4 "Rejected" — {rejection_reason} interpolated. */
  rejected: (reason: string) =>
    `US registration needs a fix: ${reason}. Update and resubmit — it takes 2 minutes.`,
  /** §4.4 "Approved". */
  approved: "US texting is live.",
  /** G7: the green toast fired on the approval realtime event. */
  approvedToast: "You're live — US texting is on.",
} as const;

/**
 * SPEC §4.1 step 4 checkout copy (verbatim, shown before payment) — rendered
 * as the honest-timeline card on the plan step (DESIGN.md G7 step 4).
 */
export const HONEST_TIMELINE = [
  "Receiving texts works the moment your number is ready (minutes).",
  "Texting Canadian numbers works immediately.",
  "Texting US numbers activates after carrier approval — typically 3–7 business days. We'll email you the moment you're approved.",
] as const;

/** The CA-only variant: no US registration happens for this company. */
export const HONEST_TIMELINE_CA_ONLY = [
  HONEST_TIMELINE[0],
  HONEST_TIMELINE[1],
  "US texting is off for your account — you can turn it on any time in Settings.",
] as const;
