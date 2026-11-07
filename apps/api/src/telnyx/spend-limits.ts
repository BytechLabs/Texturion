/**
 * #642: the vendor-side daily spend limit on production's Telnyx profiles.
 *
 * The app's own per-company caps are the first line. This is the second: Telnyx
 * itself refuses new calls on the outbound voice profile, and texts on a
 * messaging profile, once a UTC day's charges reach the limit, and emails the
 * account when it does. It catches a bug that spends faster than the app's caps
 * notice.
 *
 * The figure is sized from production's real spend (docs/deploy/04-telnyx.md
 * section 8): the larger of ten times the busiest real day and USD 25, so it
 * never stops a real customer day. Raising a limit in the portal is fine.
 */

/** What every production profile must carry at least, in USD per UTC day. */
const TELNYX_DAILY_SPEND_LIMIT_USD = 25;

/** The wire form Telnyx takes: a decimal string with two places. */
export const TELNYX_DAILY_SPEND_LIMIT = TELNYX_DAILY_SPEND_LIMIT_USD.toFixed(2);

/** Telnyx's code for a send refused because its profile reached its daily limit. */
export const MESSAGING_SPEND_LIMIT_CODE = "40333";
