/**
 * Stable API error codes (SPEC §7, D10). Every error the api Worker returns
 * uses the envelope `{ error: { code, message } }` with one of these codes.
 */
export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "subscription_inactive",
  // #303: this workspace's OWN sending is paused under the AUP enforcement
  // ladder. A structural code rather than a 403 with prose because it means
  // something different from every other refusal here: nothing is wrong with
  // this recipient, this plan or this token, and the remedy is a conversation
  // with a person rather than anything the client can offer. Clients route on
  // it to say so plainly instead of showing a generic failure a crew would
  // read as a bug in the app. Shares the 403 status with `forbidden`.
  "sending_suspended",
  // #277: this workspace's plan is PAUSED — the seasonal hold that keeps the
  // number, the history and the 10DLC registration while the crew is not
  // working. A distinct code rather than `subscription_inactive` because both
  // the fact and the remedy differ: nothing lapsed, nothing is at risk, and the
  // fix is one button that resumes the plan. And emphatically not
  // `sending_suspended`, whose copy accuses somebody of something — telling a
  // customer their workspace is "under review" because they chose a cheaper
  // winter is the worst sentence this product could send them. Shares the 402
  // status with `subscription_inactive`: money is still the remedy.
  "workspace_paused",
  "usage_cap_reached",
  "registration_pending",
  "recipient_opted_out",
  "validation_failed",
  "not_found",
  "conflict",
  // Compose-only (SPEC §5, D4): a new outbound conversation lands in the
  // destination's quiet hours (8pm–8am local). Structural signal so the UI
  // shows the confirm dialog by CODE, never by sniffing the 409 message.
  // Shares the 409 status and envelope with `conflict`.
  "quiet_hours_confirmation_required",
  // #314: this workspace requires a second factor, the grace window has
  // passed, and this token does not have one. A structural signal rather than
  // a 403 with prose, because all three clients have to ROUTE on it — to the
  // enrolment screen, not to an error toast. Shares the 403 status with
  // `forbidden`.
  "mfa_required",
  // #496: this user HOLDS a verified factor and this token is aal1 — enrolling
  // is itself the demand, with no workspace policy and no grace window
  // involved. Distinct from `mfa_required` because the remedy is the opposite
  // one: that code says "you have no factor, go and enrol", this says "you have
  // one, enter a code". Sending somebody already enrolled to the enrolment
  // screen is a dead end that invites them to add a SECOND factor to fix being
  // asked for the first. Shares the 403 status with `forbidden`.
  "mfa_challenge_required",
  // #537: prove it is you by the code we emailed, because you hold no
  // authenticator to be challenged on. Distinct from `mfa_challenge_required`
  // because the remedy is a different screen — that one says "open your
  // authenticator app", this one says "check your email" — and a client that
  // conflated them would send somebody hunting for an app they never installed.
  // Shares the 403 status with its sibling so the two forks look alike.
  "confirmation_code_required",
  // #581/#7: the same act, asked of somebody who DOES hold an authenticator, and
  // whose last proof of it has gone stale. Its own code rather than reusing
  // either sibling, because the remedy differs from both: `mfa_challenge_required`
  // is a wall in front of the whole workspace, `confirmation_code_required` sends
  // you to your email, and this one says "tap your authenticator again for this
  // one act" — with the emailed code still available as the way round it, which
  // is why the act is never actually refused.
  //
  // 403 like its two siblings, so the three forks look alike on the wire.
  "mfa_reprove_required",
  "rate_limited",
  // #283: a subsystem is switched off at the runtime kill switch — an
  // operator's deliberate act during an incident, not the customer's fault and
  // not a permanent state. Distinct from every code above because the client
  // must say "paused, try shortly" rather than "you cannot do this".
  "service_unavailable",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * HTTP status for each code, exactly as specified in the SPEC §7 table.
 */
export const ERROR_CODE_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  subscription_inactive: 402,
  sending_suspended: 403,
  workspace_paused: 402,
  usage_cap_reached: 402,
  registration_pending: 403,
  recipient_opted_out: 403,
  validation_failed: 422,
  not_found: 404,
  conflict: 409,
  quiet_hours_confirmation_required: 409,
  mfa_required: 403,
  mfa_challenge_required: 403,
  confirmation_code_required: 403,
  mfa_reprove_required: 403,
  rate_limited: 429,
  service_unavailable: 503,
} as const satisfies Record<ErrorCode, number>;

/**
 * Fallback code for unhandled exceptions in the api Worker's `onError` hook.
 * SPEC §7 deliberately defines no 500 code — every specified failure path maps
 * to one of the ten codes above — so this is the single code outside that
 * table, defined here so the full set of codes a client can observe has one
 * source of truth. The response keeps the SPEC §7 envelope shape.
 */
export const INTERNAL_ERROR_CODE = "internal_error" as const;

/** HTTP status paired with {@link INTERNAL_ERROR_CODE}. */
export const INTERNAL_ERROR_STATUS = 500 as const;

/** Every code a client can observe: the SPEC §7 table plus the 500 fallback. */
export type ApiErrorCode = ErrorCode | typeof INTERNAL_ERROR_CODE;

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
