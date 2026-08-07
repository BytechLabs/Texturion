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
  /**
   * #522: the currency this workspace is actually billed in
   * (`companies.billing_currency`), NOT a guess from its country. A Canadian
   * workspace reads `usd` here whenever that is what Stripe charged it, which
   * is every workspace today.
   *
   * Required rather than optional on purpose: this interface exists so four
   * codebases decide eligibility once, and an optional field is one three of
   * them forget.
   */
  billingCurrency: string;
}

/**
 * The currency the extra-number prices are filed in — USD only.
 *
 * Not an oversight and not derivable: the CAD price book was decided item by
 * item and its ratios are all different (2900→3900, 7900→10900, 3→4, 2.5→3.5,
 * 1→1.5), so there is no rule that yields a CAD figure for a $5 or $4 line.
 * Until someone decides one, this is the honest state.
 */
export const EXTRA_NUMBER_CURRENCY = "usd";

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
  // #522: a Stripe subscription bills in ONE currency, and every item on it has
  // to carry an amount in that currency. The extra-number prices are filed in
  // USD only (see EXTRA_NUMBER_CURRENCY for why no CAD figure exists to file),
  // so adding one to a subscription billed in anything else is refused by
  // Stripe outright.
  //
  // Said here, in a sentence, rather than left to surface as a failed charge and
  // a "Something went wrong". Nothing is attempted, so no money moves and the
  // reason names what would have to change.
  //
  // Fires for nobody today: the catalog is USD-only, so `checkoutCurrency`
  // records `usd` for every workspace including Canadian ones. It starts
  // mattering the day CAD is genuinely filed — which is exactly the day this
  // would otherwise have become a support ticket nobody could explain.
  if (args.billingCurrency.trim().toLowerCase() !== EXTRA_NUMBER_CURRENCY) {
    return (
      "Extra numbers are priced in US dollars and can't be added to a " +
      "subscription billed in another currency yet. Contact support and we'll " +
      "sort it out."
    );
  }
  return null;
}

/** Convenience for call sites that only need the yes/no. */
export function canBuyExtraNumber(args: ExtraNumberEligibility): boolean {
  return extraNumberBlockedReason(args) === null;
}
