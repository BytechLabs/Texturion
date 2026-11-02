/**
 * #643: what limits Telnyx puts on production's account, as measured.
 *
 * No Telnyx API exposes the account level or its limits, so the figure here is
 * evidence, recorded with its source in docs/deploy/04-telnyx.md section 9.
 * When the account's level changes, change the number and that section
 * together.
 */

/**
 * The account-wide concurrent call limit. On 2026-11-01 the guard's validation
 * check wrote `concurrent_call_limit` on an outbound voice profile with no
 * connection: Telnyx accepted 10 and refused 11. Telnyx documents the field as
 * "Must be no more than your global concurrent call limit", so the global limit
 * is 10. That is above the Paid level's 5, so the account is not at Paid.
 */
export const TELNYX_CONCURRENT_CALL_LIMIT = 10;

/**
 * Telnyx legs one call can hold at once. A call that two people are on is a
 * customer leg and a member leg. Telnyx's docs do not say whether SIP-URI ring
 * legs count, so they are counted: the check errs toward a warning.
 */
export const LEGS_PER_ANSWERED_CALL = 2;
