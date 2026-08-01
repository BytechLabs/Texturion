/**
 * #399 — referrals, and the rules that keep a free month from being free money.
 *
 * # Why this is out of band, and stays that way
 *
 * The obvious implementation is "invite your contacts" with a prefilled message
 * from the customer's business number. That is exactly the mass-texting this
 * product refuses to do: D4 and D11 exclude blasts on compliance grounds, the
 * AUP forbids purchased lists, and #396 exists to honour informal opt-outs.
 * Turning a crew's consented customer list into an acquisition funnel would
 * contradict all three and deserve to.
 *
 * So the product supplies a LINK and the accounting, never the distribution.
 * The owner sends it however they like — WhatsApp, a text from their own phone,
 * a conversation at a supply counter. That is not a limitation worked around;
 * it is what makes the mechanism defensible for a compliance-forward product.
 *
 * # Why the reward waits for activation
 *
 * A free month is real money, and the cost-protection mandate says cap every
 * cost centre before it is prompted. Self-referral and referral farming are the
 * standard failure modes, and paying on SIGNUP funds both: a signup costs an
 * attacker nothing but an email address.
 *
 * Paying on ACTIVATION instead — the referee actually sending a message from a
 * paid workspace — closes most of it for free, because the cheapest way to fake
 * it is to become a paying customer who uses the product.
 */

/**
 * The alphabet a referral code is drawn from.
 *
 * No 0/O, no 1/I/L. A code's whole job is to survive being read aloud at a
 * supply counter and typed by somebody else, and those are the characters that
 * do not survive it.
 */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** How long a code is. Eight of this alphabet is ~40 bits — unguessable. */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * How many rewards one workspace may earn in a rolling year.
 *
 * A cap, because an uncapped free month is an uncapped bill and this product
 * has one founder. Twelve is far above any plausible honest referrer — a crew
 * that genuinely brings us twelve paying businesses in a year is a
 * conversation to have, not a payout to automate.
 */
export const REFERRAL_REWARDS_PER_YEAR = 12;

/**
 * Normalise a code as typed: upper-cased, with formatting stripped.
 *
 * FORMATTING ONLY. It is tempting to also fold the confusable characters —
 * O to 0, I and L to 1 — so a mis-heard code still works. That is a mistake
 * twice over. The alphabet excludes BOTH sides of each pair, so folding
 * produces a character that is still invalid; and mapping one character to
 * another risks turning a typo into a DIFFERENT VALID CODE, which would credit
 * a stranger's referral to somebody who never made it.
 *
 * Excluding the confusable characters from the alphabet is what solves this.
 * A code we mint can never contain them, so a code containing one was mistyped,
 * and the honest answer is to say so rather than to guess.
 */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when a string is shaped like one of our codes. */
export function isReferralCode(raw: string): boolean {
  if (raw.length !== REFERRAL_CODE_LENGTH) return false;
  for (const character of raw) {
    if (!REFERRAL_CODE_ALPHABET.includes(character)) return false;
  }
  return true;
}

/**
 * Mint a code from a source of randomness.
 *
 * Rejection-free: the alphabet's length does not divide 256, so taking bytes
 * modulo the length would bias toward the first characters. Whether that
 * matters for a referral code is arguable; doing it right costs one line.
 */
export function mintReferralCode(random: (n: number) => Uint8Array): string {
  const out: string[] = [];
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const byte of random(REFERRAL_CODE_LENGTH)) {
      if (out.length >= REFERRAL_CODE_LENGTH) break;
      // 248 = 31 * 8, the largest multiple of the alphabet under 256. Bytes
      // above it are discarded rather than folded, which is what keeps every
      // character equally likely.
      if (byte >= 248) continue;
      out.push(REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length]);
    }
  }
  return out.join("");
}

export type ReferralRefusal =
  | "self_referral"
  | "already_referred"
  | "referrer_capped"
  | "unknown_code";

export interface ReferralClaim {
  /** The workspace whose code was used, or null when the code is unknown. */
  referrerCompanyId: string | null;
  /** The owner of the referring workspace, for the self-referral check. */
  referrerOwnerUserId: string | null;
  /** How many rewards the referrer has already earned this year. */
  referrerRewardsThisYear: number;
  /** True when this workspace has already been referred by anyone, ever. */
  refereeAlreadyReferred: boolean;
}

export interface ReferralDecision {
  accepted: boolean;
  refusal?: ReferralRefusal;
}

/**
 * May this referral be recorded?
 *
 * Every rule here is a fraud rule, and each closes a specific hole:
 *
 * SELF-REFERRAL is the obvious one, and the check is on the OWNER rather than
 * the workspace: one person opening a second workspace to refer themselves is
 * the cheap attack, and comparing company ids would miss it entirely.
 *
 * ONE REFERRAL PER REFEREE, EVER. Without it a workspace could be "referred"
 * repeatedly by different codes, which turns one signup into an unbounded
 * number of payouts.
 *
 * THE REFERRER'S CAP. An uncapped free month is an uncapped bill.
 *
 * An UNKNOWN CODE is not an error the visitor should see. Codes get retyped
 * and mis-heard; a signup that proceeds without attribution is a customer we
 * still have, and a signup blocked on a typo is one we do not.
 */
export function decideReferral(claim: ReferralClaim, refereeOwnerUserId: string): ReferralDecision {
  if (!claim.referrerCompanyId) return { accepted: false, refusal: "unknown_code" };
  if (claim.refereeAlreadyReferred) {
    return { accepted: false, refusal: "already_referred" };
  }
  if (
    claim.referrerOwnerUserId !== null &&
    claim.referrerOwnerUserId === refereeOwnerUserId
  ) {
    return { accepted: false, refusal: "self_referral" };
  }
  if (claim.referrerRewardsThisYear >= REFERRAL_REWARDS_PER_YEAR) {
    return { accepted: false, refusal: "referrer_capped" };
  }
  return { accepted: true };
}

/** What the referrer sees about one referral they made. */
export type ReferralStage = "invited" | "signed_up" | "active" | "rewarded";

/**
 * How far along a referral is, from the two timestamps that record it.
 *
 * #399 asks for exactly this: invited, signed up, still active at 30 days. A
 * referral programme whose results nobody can see gets used once.
 */
export function referralStage(row: {
  qualifiedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
}, now: Date): ReferralStage {
  if (row.rewardedAt) return "rewarded";
  if (row.qualifiedAt) {
    const qualified = Date.parse(row.qualifiedAt);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return now.getTime() - qualified >= thirtyDays ? "active" : "signed_up";
  }
  return "invited";
}
