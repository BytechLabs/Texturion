import {
  decideReferral,
  isReferralCode,
  mintReferralCode,
  normalizeReferralCode,
  type ReferralClaim,
  type ReferralDecision,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isPauseLicensedPrice } from "../billing/plans";
import {
  itemHasDiscount,
  licensedItemOf,
  prepaidCouponPending,
} from "../billing/prepay";
import { getStripe } from "../billing/stripe";
import type { Env } from "../env";

/**
 * #399 — referrals: minting a workspace's code, attributing a signup to one,
 * and noticing when the referee actually starts using the product.
 *
 * The decision itself is `decideReferral` in packages/shared. This file is the
 * plumbing around it: reads, writes, and the one retry that matters.
 *
 * NOTHING HERE DISTRIBUTES ANYTHING, and that is the design rather than an
 * omission. #399 is explicit that an "invite your contacts" flow would be the
 * mass-texting D4 and D11 exclude — it would turn a crew's consented customer
 * list into an acquisition funnel. The product hands the owner a link; where it
 * goes is their business.
 */

/** How many times to retry a code collision before giving up. */
const MINT_ATTEMPTS = 5;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * This workspace's referral code, minting one the first time it is asked for.
 *
 * Lazy rather than at company creation: most workspaces will never look at the
 * referral screen, and a column that is populated for everybody is a column
 * that has to be backfilled and kept unique for no reason. The first person to
 * open the screen gets one.
 *
 * The retry is not paranoia. The code is short enough to be read aloud, so the
 * space is finite and a collision is a normal event at scale rather than an
 * error — the unique index is what makes the collision safe, and this is what
 * makes it invisible.
 */
export async function ensureReferralCode(
  db: SupabaseClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await db
    .from("companies")
    .select("referral_code")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const existing = (data?.[0] as { referral_code: string | null } | undefined)
    ?.referral_code;
  if (existing) return existing;

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const code = mintReferralCode(randomBytes);
    const { data: updated, error: updateError } = await db
      .from("companies")
      .update({ referral_code: code })
      // Only if nobody won the race in between: two tabs opening the screen at
      // once must not produce two codes, one of which is then unreachable.
      .eq("id", companyId)
      .is("referral_code", null)
      .select("referral_code");
    if (!updateError && (updated ?? []).length > 0) return code;

    // A unique violation means somebody else has this code; anything else and
    // the row already had one, so read it back rather than looping.
    if (updateError && !/duplicate key|unique/i.test(updateError.message)) {
      throw new Error(`referral code mint failed: ${updateError.message}`);
    }
    if (!updateError) {
      const { data: raced } = await db
        .from("companies")
        .select("referral_code")
        .eq("id", companyId)
        .limit(1);
      const won = (raced?.[0] as { referral_code: string | null } | undefined)
        ?.referral_code;
      if (won) return won;
    }
  }
  throw new Error(`referral code mint failed after ${MINT_ATTEMPTS} attempts`);
}

export interface ReferralAttribution {
  recorded: boolean;
  refusal?: ReferralDecision["refusal"] | "not_a_code";
}

/**
 * Attribute a brand-new workspace to a referral code, if the code earns it.
 *
 * NEVER THROWS ON A BAD CODE, and never blocks the caller. A signup that
 * proceeds without attribution is a customer we still have; a signup that 500s
 * because somebody mistyped eight characters is one we do not. Every refusal is
 * a returned value, and the only thing that raises here is a database that is
 * actually broken.
 */
export async function attributeReferral(
  db: SupabaseClient,
  args: {
    rawCode: string;
    refereeCompanyId: string;
    refereeOwnerUserId: string;
  },
): Promise<ReferralAttribution> {
  const code = normalizeReferralCode(args.rawCode);
  // A mistyped code is rejected rather than guessed at: the alphabet excludes
  // every confusable character precisely so a code containing one is known to
  // be wrong, and mapping it onto a neighbour could credit a stranger.
  if (!isReferralCode(code)) return { recorded: false, refusal: "not_a_code" };

  const { data, error } = await db.rpc("referral_claim_facts", {
    p_code: code,
    p_referee_company: args.refereeCompanyId,
  });
  if (error) throw new Error(`referral_claim_facts failed: ${error.message}`);

  const facts = data as {
    referrer_company_id: string;
    referrer_owner_user_id: string | null;
    referrer_rewards_this_year: number;
    referee_already_referred: boolean;
  } | null;

  const claim: ReferralClaim = {
    referrerCompanyId: facts?.referrer_company_id ?? null,
    referrerOwnerUserId: facts?.referrer_owner_user_id ?? null,
    referrerRewardsThisYear: Number(facts?.referrer_rewards_this_year ?? 0),
    refereeAlreadyReferred: facts?.referee_already_referred ?? false,
  };
  const decision = decideReferral(claim, args.refereeOwnerUserId);
  if (!decision.accepted) return { recorded: false, refusal: decision.refusal };

  const { data: recorded, error: recordError } = await db.rpc("record_referral", {
    p_company_id: claim.referrerCompanyId,
    p_referee_company: args.refereeCompanyId,
    p_code: code,
  });
  if (recordError) throw new Error(`record_referral failed: ${recordError.message}`);
  const outcome = (recorded as { outcome?: string } | null)?.outcome;
  return outcome === "recorded"
    ? { recorded: true }
    : { recorded: false, refusal: outcome === "self_referral" ? "self_referral" : "already_referred" };
}

/**
 * The referee just sent their first real message. Mark the referral qualified.
 *
 * Returns whether THIS call was the one that qualified it, so a caller only
 * issues rewards on the transition. Every send after the first is a no-op.
 *
 * Never throws: this rides on the send path, and a referral bookkeeping problem
 * must never be able to fail a customer's text.
 */
export async function qualifyReferralForSender(
  env: Env,
  db: SupabaseClient,
  refereeCompanyId: string,
): Promise<{ qualified: boolean; referrerCompanyId?: string }> {
  try {
    const { data, error } = await db.rpc("qualify_referral", {
      p_referee_company: refereeCompanyId,
    });
    if (error) {
      console.error(`qualify_referral failed: ${error.message}`);
      return { qualified: false };
    }
    const row = data as
      | {
          outcome?: string;
          referral_id?: string;
          referrer_company_id?: string;
          referee_company_id?: string;
        }
      | null;
    if (row?.outcome !== "qualified") return { qualified: false };
    // Only on the TRANSITION, which the RPC guarantees by stamping once. Both
    // sides are paid here rather than by a cron, because the moment somebody
    // earns a month is the moment to give it to them.
    if (row.referral_id && row.referrer_company_id && row.referee_company_id) {
      await rewardQualifiedReferral(env, db, {
        referralId: row.referral_id,
        referrerCompanyId: row.referrer_company_id,
        refereeCompanyId: row.referee_company_id,
      });
    }
    return { qualified: true, referrerCompanyId: row.referrer_company_id };
  } catch (cause) {
    console.error(`qualify_referral threw: ${String(cause)}`);
    return { qualified: false };
  }
}

/**
 * Give one side of a qualified referral their free month.
 *
 * A 100%-off coupon on the LICENSED item, `duration: once` — the same shape the
 * prepaid year uses, and for the same reason: a "free month" should cover the
 * plan fee and never the metered overage, which is a carrier cost we have
 * already paid. A subscription-level coupon would make somebody's texts free.
 *
 * The stamp comes AFTER Stripe, guarded in SQL on the timestamp being null, so
 * a repeat call cannot issue a second month. It is the reverse order from the
 * prepaid-year grant, and deliberately: there the hazard was re-applying a
 * TWELVE-month coupon and restarting it, so the claim had to come first. Here
 * the coupon is `once` and idempotent in effect — applying it twice before the
 * stamp lands costs at most the month that was already owed, while stamping
 * first would risk marking a reward that never arrived.
 *
 * #277 — A PAUSED WORKSPACE IS SKIPPED AND LEFT UNSTAMPED. Its licensed item is
 * priced at the ~$5 holding fee, so a free month applied now would be spent on
 * the hold rather than on the $29/$79 plan it was earned against — the customer
 * would watch a month they earned buy them nothing. Returning false without
 * stamping is what makes that recoverable: the row keeps its null timestamp and
 * {@link payPendingReferralRewards} pays it the moment the plan comes back. The
 * cancelled-subscription case just below has always worked this way; a pause is
 * the same shape and was simply invisible, because a paused workspace looks
 * completely healthy from here.
 */
async function rewardSide(
  env: Env,
  db: SupabaseClient,
  args: { referralId: string; companyId: string; side: "referrer" | "referee" },
): Promise<boolean> {
  const coupon = env.STRIPE_REFERRAL_MONTH_COUPON_ID;
  // Unset coupon = referrals record and display but never pay out. An honest
  // half-state: the accounting should exist before the money does.
  if (!coupon) return false;

  const { data, error } = await db
    .from("companies")
    .select("stripe_subscription_id")
    .eq("id", args.companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const subscriptionId = (
    data?.[0] as { stripe_subscription_id: string | null } | undefined
  )?.stripe_subscription_id;
  // No subscription, nothing to discount. A referrer who has since cancelled
  // earns nothing rather than erroring — they can come back and the row keeps
  // its unstamped state.
  if (!subscriptionId) return false;

  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const licensed = licensedItemOf(env, subscription);
  if (!licensed) {
    // Say WHICH of the two no-plan-item shapes this is, because they need
    // different things from us: a pause will be paid on resume and needs
    // nothing, while an unrecognised subscription is a catalog problem.
    const paused = subscription.items.data.some(
      (item) => item.price && isPauseLicensedPrice(env, item.price.id),
    );
    console.log(
      `referral reward (${args.side}) held for ${args.companyId}: ` +
        (paused ? "workspace paused, pays on resume" : "no plan licensed item"),
    );
    return false;
  }

  /**
   * A prepaid year is running, so the month is HELD rather than paid.
   *
   * The write below sends `discounts: [{ coupon }]`, and that REPLACES the item's
   * discount array — the same semantics `revokePrepaidYear` depends on when it
   * clears with `discounts: []`. A prepaid year is a 100%-off/12-month coupon on
   * this exact item, so paying the reward here would delete it: the customer
   * keeps being billed the full plan price for months they already paid for,
   * while `prepayments.granted_through` still records them as covered. Up to
   * $790 of paid service, destroyed by a referee sending their first text, with
   * nothing detecting it.
   *
   * `itemHasDiscount` below cannot see this — it is asked only about the referral
   * coupon — which is why the check is separate and comes first.
   *
   * Held, not merged: with the plan line already at $0, a `duration: once`
   * referral coupon would be consumed against a $0 invoice and the free month
   * would evaporate. Returning WITHOUT stamping is what makes it a hold —
   * `payPendingReferralRewards` retries unstamped qualified rows behind every
   * send, so the month lands by itself once the year ends. Exactly the shape the
   * paused-workspace branch above already uses.
   *
   * `pauseEligibility` carries both sides of this collision with a test behind
   * it; this path carried neither, which is what makes it an omission rather
   * than a policy.
   */
  if (prepaidCouponPending(env, subscription)) {
    console.log(
      `referral reward (${args.side}) held for ${args.companyId}: ` +
        "prepaid year running, pays when it ends",
    );
    return false;
  }

  if (!itemHasDiscount(licensed, coupon)) {
    await stripe.subscriptions.update(
      subscriptionId,
      { items: [{ id: licensed.id, discounts: [{ coupon }] }] },
      { idempotencyKey: `referral_reward:${args.referralId}:${args.side}` },
    );
  }
  const { error: stampError } = await db.rpc("stamp_referral_reward", {
    p_referral_id: args.referralId,
    p_side: args.side,
    p_coupon_id: coupon,
  });
  if (stampError) {
    console.error(`stamp_referral_reward failed: ${stampError.message}`);
  }
  return true;
}

/**
 * Pay both sides of a referral that has just qualified.
 *
 * Never throws. This runs behind a send, and one side failing must not stop the
 * other: a referrer whose subscription lapsed should not cost the referee the
 * month they earned by actually using the product.
 */
export async function rewardQualifiedReferral(
  env: Env,
  db: SupabaseClient,
  args: { referralId: string; referrerCompanyId: string; refereeCompanyId: string },
): Promise<void> {
  for (const [side, companyId] of [
    ["referrer", args.referrerCompanyId],
    ["referee", args.refereeCompanyId],
  ] as const) {
    try {
      await rewardSide(env, db, { referralId: args.referralId, companyId, side });
    } catch (cause) {
      console.error(`referral reward (${side}) failed: ${String(cause)}`);
    }
  }
}

/**
 * Pay a month this workspace earned while it had nothing to discount.
 *
 * ONE month per call, not all of them — the loop below says why, and the count
 * it returns is how many actually landed rather than how many were owed.
 *
 * #277 — the other half of the pause. `rewardSide` refuses to spend a free month
 * on a ~$5 holding fee and leaves the row unstamped, which is the correct
 * decision and also, on its own, a month quietly lost: nothing in this product
 * sweeps unstamped rewards, so without a retry "paid on resume" is a comment
 * rather than a behaviour. This is the retry, and `POST /v1/billing/resume` is
 * where it runs — the moment the licensed item is a plan again is the moment the
 * month is worth what it was earned for.
 *
 * THE REFERRER SIDE ONLY, and that is a fact about the product rather than a
 * shortcut. A referee's month is earned by `qualifyReferralForSender`, which
 * fires on an ACCEPTED OUTBOUND SEND — and a paused workspace cannot send at
 * all, because all five SQL gates refuse it. So a referee can never be sitting
 * on a month held back by a pause; only the referrer, whose referee activated
 * while they were away for the winter, can. Reading the referee side too would
 * mean selecting rows owned by ANOTHER tenant (`referrals.company_id` is the
 * referrer's), which is the read the #347 scope guard exists to make somebody
 * argue for. There is nothing to argue for here.
 *
 * NEVER THROWS. It runs after a resume that has already charged the customer;
 * a referral bookkeeping problem must not turn that into a 500, and every reward
 * it fails to pay is still sitting unstamped for the next attempt.
 */
export async function payPendingReferralRewards(
  env: Env,
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  let paid = 0;
  try {
    const { data, error } = await db
      .from("referrals")
      .select("id")
      .eq("company_id", companyId)
      // Nothing is owed before the referee actually sent something; a voided row
      // is a reward somebody decided against; and a stamped one has been paid.
      // None of the three is a retry.
      .not("qualified_at", "is", null)
      .is("voided_at", null)
      .is("referrer_rewarded_at", null);
    if (error) throw new Error(`referrals lookup failed: ${error.message}`);

    for (const row of (data ?? []) as { id: string }[]) {
      try {
        if (
          await rewardSide(env, db, {
            referralId: row.id,
            companyId,
            side: "referrer",
          })
        ) {
          paid += 1;
          // ONE MONTH PER CALL, and the rest stay owed rather than being spent.
          //
          // The coupon is `duration: once` and `rewardSide` writes
          // `discounts: [{ coupon }]`, which REPLACES the item's discounts — so
          // a second one applied before the first reaches an invoice is not a
          // second month, it is the same month written twice. The loop would
          // still stamp every row it visited, because `itemHasDiscount` reads
          // the coupon it just put there and skips straight to the stamp. A
          // referrer who was away for the winter with three qualified referrals
          // would come back, receive ONE free month, and find all three recorded
          // as paid.
          //
          // Stopping here leaves the others unstamped, which is the state the
          // whole pause/resume path is built on: unstamped means still owed, and
          // still visible to the next attempt. It does mean a second held month
          // waits for the next resume rather than the next invoice — a month
          // late is recoverable, a month silently consumed is not.
          break;
        }
      } catch (cause) {
        console.error(`pending referral reward failed: ${String(cause)}`);
      }
    }
  } catch (cause) {
    console.error(
      `pending referral rewards failed for ${companyId}: ${String(cause)}`,
    );
  }
  return paid;
}
