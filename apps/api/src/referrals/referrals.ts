import {
  decideReferral,
  isReferralCode,
  mintReferralCode,
  normalizeReferralCode,
  type ReferralClaim,
  type ReferralDecision,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

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
      | { outcome?: string; referrer_company_id?: string }
      | null;
    if (row?.outcome !== "qualified") return { qualified: false };
    return { qualified: true, referrerCompanyId: row.referrer_company_id };
  } catch (cause) {
    console.error(`qualify_referral threw: ${String(cause)}`);
    return { qualified: false };
  }
}
