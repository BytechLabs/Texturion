/**
 * #642: the vendor-side daily spend limit on production's Telnyx profiles.
 *
 * The app's own per-company caps are the first line. This is the second: Telnyx
 * itself refuses new calls on the outbound voice profile, and texts on a
 * messaging profile, once a UTC day's charges reach the limit. It catches a
 * bug that spends faster than the app's caps notice.
 *
 * The figure is sized from production's real spend (docs/deploy/04-telnyx.md
 * section 8): the larger of ten times the busiest real day and USD 25, so it
 * never stops a real customer day. Raising a limit in the portal is fine. The
 * hourly gauges report a limit that is missing, disabled or lower, and the
 * PostHog alert fires on it (D146).
 */

/** What every production profile must carry at least, in USD per UTC day. */
export const TELNYX_DAILY_SPEND_LIMIT_USD = 25;

/** The wire form Telnyx takes: a decimal string with two places. */
export const TELNYX_DAILY_SPEND_LIMIT = TELNYX_DAILY_SPEND_LIMIT_USD.toFixed(2);

/** Telnyx's code for a send refused because its profile reached its daily limit. */
export const MESSAGING_SPEND_LIMIT_CODE = "40333";

/** A limit as Telnyx reports it on a profile. */
export interface ReportedSpendLimit {
  daily_spend_limit?: string | number | null;
  daily_spend_limit_enabled?: boolean | null;
}

/**
 * The enforced daily limit in USD, or null when none is. Telnyx reports an
 * unset limit as "" or "0.00" with the flag null or false, so only an enabled,
 * positive amount counts: a disabled profile spends without bound whatever
 * figure it holds.
 */
export function enforcedSpendLimit(profile: ReportedSpendLimit): number | null {
  if (profile.daily_spend_limit_enabled !== true) return null;
  const raw = profile.daily_spend_limit;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
