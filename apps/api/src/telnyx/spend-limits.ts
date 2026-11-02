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
 * drift watch only objects to a limit that is missing, disabled or lower.
 */

/** What every production profile must carry at least, in USD per UTC day. */
export const TELNYX_DAILY_SPEND_LIMIT_USD = 25;

/** The wire form Telnyx takes: a decimal string with two places. */
export const TELNYX_DAILY_SPEND_LIMIT = TELNYX_DAILY_SPEND_LIMIT_USD.toFixed(2);

/** The pre-cap alert fires from this share of a limit. */
export const SPEND_ALERT_FRACTION = 0.7;

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

/** Why a profile's limit is out of line with {@link TELNYX_DAILY_SPEND_LIMIT_USD}, or null when it is not. */
export function spendLimitDrift(profile: ReportedSpendLimit): string | null {
  const enforced = enforcedSpendLimit(profile);
  if (enforced === null) {
    return profile.daily_spend_limit_enabled === true
      ? "the limit is enabled with no usable amount"
      : "no daily spend limit is enforced";
  }
  if (enforced < TELNYX_DAILY_SPEND_LIMIT_USD) {
    return `the limit is USD ${enforced.toFixed(2)}, below the USD ${TELNYX_DAILY_SPEND_LIMIT} floor`;
  }
  return null;
}
