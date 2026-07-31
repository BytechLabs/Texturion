/**
 * #464 — "Why is extra phone number US only?? that makes no sense".
 *
 * It didn't. The rule refused every non-US company outright:
 *
 *     if (country !== "US" || !usTextingEnabled) refuse
 *
 * which conflated two unrelated things. `usTextingEnabled` is the 10DLC
 * registration gate, and it is real: a US number cannot text until the
 * carriers approve the brand. **Canada has no such registration** — a Canadian
 * workspace texts the day its number is active, and so `us_texting_enabled` is
 * never true for one. The condition therefore said "no" to Canadians forever,
 * for a reason that does not apply to them.
 *
 * Provisioning was NOT the constraint. Telnyx returned Canadian inventory
 * masked and un-orderable when this was first written (number_reservations
 * answered 10038, an account-level block), which is why the whole path was
 * left US-shaped. Re-checked against the live account on 2026-07-31: CA
 * inventory now comes back FULLY REVEALED and reservable — 437, 905, 289, 613,
 * 604, 778, 587, 902, 438, 204 and 431 all return stock on the exact filter
 * set the provisioner uses. 416 and 647 are simply exhausted (Toronto's original
 * codes), and the provisioner already falls back from the area code to its
 * NANP region, which answers a 416 request with an Ontario number.
 *
 * The gate is now per country, which is what it always should have been:
 * a US workspace waits for registration, a Canadian one does not.
 *
 * Lives here so the API, the web app and the two phone clients decide this
 * once. It was duplicated in three of those four, which is how the web copy
 * and the server rule drifted apart in the first place.
 */

export type NumberCountry = "US" | "CA";
export type ExtraNumberPlan = "starter" | "pro";

/** Starter's hard TOTAL number cap: 1 included + at most 1 extra (#80). */
export const STARTER_MAX_TOTAL_NUMBERS = 2;

export interface ExtraNumberEligibility {
  plan: ExtraNumberPlan;
  /** Numbers the company holds right now (anything not released). */
  currentCount: number;
  country: NumberCountry;
  /** 10DLC approval. Meaningful for US only; never true for a CA workspace. */
  usTextingEnabled: boolean;
}

/**
 * Why this company cannot buy one more number, or null when it can.
 *
 * The string is customer-facing and is the ONLY explanation they get, so it
 * names the actual gate and what clears it — never a bare "not available".
 */
export function extraNumberBlockedReason(
  args: ExtraNumberEligibility,
): string | null {
  // US only: the carriers must approve the brand before a US number can text,
  // so selling a second one first would sell something that cannot be used.
  if (args.country === "US" && !args.usTextingEnabled) {
    return "An extra number needs US texting turned on for your workspace first.";
  }
  if (
    args.plan === "starter" &&
    args.currentCount >= STARTER_MAX_TOTAL_NUMBERS
  ) {
    return `Starter tops out at ${STARTER_MAX_TOTAL_NUMBERS} numbers (1 included + 1 extra). Move to Pro for more.`;
  }
  return null;
}

/** Convenience for call sites that only need the yes/no. */
export function canBuyExtraNumber(args: ExtraNumberEligibility): boolean {
  return extraNumberBlockedReason(args) === null;
}
