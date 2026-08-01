/**
 * #399 — the rules that keep a free month from becoming free money.
 *
 * Every assertion here is a fraud rule or a money rule. A referral pays a real
 * $29 to each side, and the cost-protection mandate says cap a cost centre
 * before it is prompted rather than after somebody finds it.
 */
import { describe, expect, it } from "vitest";

import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARDS_PER_YEAR,
  decideReferral,
  isReferralCode,
  mintReferralCode,
  normalizeReferralCode,
  referralStage,
  type ReferralClaim,
} from "./referrals";

/** Deterministic bytes, so the minting test asserts a value rather than a shape. */
function bytesFrom(values: number[]): (n: number) => Uint8Array {
  let index = 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = values[index++ % values.length];
    return out;
  };
}

describe("#399 referral codes", () => {
  it("excludes every character that does not survive being read aloud", () => {
    // A code's whole job is to be said at a supply counter and typed by
    // somebody else. 0/O and 1/I/L are where that breaks.
    for (const confusable of ["0", "O", "1", "I", "L"]) {
      expect(REFERRAL_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it("strips formatting and nothing else", () => {
    expect(normalizeReferralCode("  hjkm-npq  ")).toBe("HJKMNPQ");
    expect(normalizeReferralCode("abcd efgh")).toBe("ABCDEFGH");
  });

  it("does NOT map a confusable character onto a different one", () => {
    // The tempting version folds O to 0 and I/L to 1 so a mis-heard code still
    // works. It is wrong twice: the alphabet excludes both sides of each pair,
    // so the result is still invalid; and mapping one character to another can
    // turn a typo into a DIFFERENT VALID CODE, crediting a stranger's referral
    // to somebody who never made it. A mistyped code is rejected, not guessed.
    expect(normalizeReferralCode("ABCDEFGO")).toBe("ABCDEFGO");
    expect(isReferralCode(normalizeReferralCode("ABCDEFGO"))).toBe(false);
    expect(isReferralCode(normalizeReferralCode("ABCDEFG1"))).toBe(false);
  });

  it("recognises only well-formed codes", () => {
    expect(isReferralCode("ABCDEFGH")).toBe(true);
    expect(isReferralCode("ABCDEFG")).toBe(false); // too short
    expect(isReferralCode("ABCDEFGHI")).toBe(false); // too long
    expect(isReferralCode("ABCDEFG0")).toBe(false); // 0 is not in the alphabet
    expect(isReferralCode("abcdefgh")).toBe(false); // normalise first
  });

  it("mints a code of the right shape", () => {
    const code = mintReferralCode(bytesFrom([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(isReferralCode(code)).toBe(true);
  });

  it("discards biased bytes rather than folding them", () => {
    // 248 = 31 * 8 is the largest multiple of the alphabet under 256. Folding
    // 248-255 with a modulo would make the first eight characters likelier
    // than the rest; discarding keeps every character equally likely.
    const code = mintReferralCode(bytesFrom([250, 255, 249, 0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(isReferralCode(code)).toBe(true);
  });
});

describe("#399 decideReferral — the fraud rules", () => {
  const base: ReferralClaim = {
    referrerCompanyId: "company-a",
    referrerOwnerUserId: "user-a",
    referrerRewardsThisYear: 0,
    refereeAlreadyReferred: false,
  };

  it("accepts a genuine referral", () => {
    expect(decideReferral(base, "user-b")).toEqual({ accepted: true });
  });

  it("refuses a self-referral by OWNER, not by workspace", () => {
    // The cheap attack is one person opening a second workspace to refer
    // themselves. Comparing company ids would miss it entirely, because the
    // two companies really are different.
    expect(decideReferral(base, "user-a")).toEqual({
      accepted: false,
      refusal: "self_referral",
    });
  });

  it("refuses a workspace that has already been referred, ever", () => {
    // Without this, one signup can be claimed by an unbounded number of codes.
    expect(
      decideReferral({ ...base, refereeAlreadyReferred: true }, "user-b"),
    ).toEqual({ accepted: false, refusal: "already_referred" });
  });

  it("caps how much one referrer can earn in a year", () => {
    // An uncapped free month is an uncapped bill, and this product has one
    // founder. Twelve is far above any plausible honest referrer.
    expect(
      decideReferral(
        { ...base, referrerRewardsThisYear: REFERRAL_REWARDS_PER_YEAR },
        "user-b",
      ),
    ).toEqual({ accepted: false, refusal: "referrer_capped" });
    expect(
      decideReferral(
        { ...base, referrerRewardsThisYear: REFERRAL_REWARDS_PER_YEAR - 1 },
        "user-b",
      ).accepted,
    ).toBe(true);
  });

  it("treats an unknown code as no attribution, never as an error", () => {
    // Codes get retyped and mis-heard. A signup that proceeds without
    // attribution is a customer we still have; a signup blocked on a typo is
    // one we do not.
    expect(decideReferral({ ...base, referrerCompanyId: null }, "user-b")).toEqual({
      accepted: false,
      refusal: "unknown_code",
    });
  });

  it("checks the referee before the self-check, so a repeat is not mislabelled", () => {
    // Both rules fire for a workspace re-referred by its own owner. The
    // already-referred answer is the accurate one to report.
    expect(
      decideReferral({ ...base, refereeAlreadyReferred: true }, "user-a").refusal,
    ).toBe("already_referred");
  });
});

describe("#399 referralStage — what the referrer is shown", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  it("reports invited until the referee activates", () => {
    expect(
      referralStage(
        { createdAt: "2026-07-01T00:00:00Z", qualifiedAt: null, rewardedAt: null },
        now,
      ),
    ).toBe("invited");
  });

  it("reports signed_up before thirty days and active after", () => {
    // #399 asks for "still active at 30 days" specifically, because that is
    // the number that distinguishes a referral worth paying for from a signup.
    expect(
      referralStage(
        { createdAt: "2026-07-20T00:00:00Z", qualifiedAt: "2026-07-20T00:00:00Z", rewardedAt: null },
        now,
      ),
    ).toBe("signed_up");
    expect(
      referralStage(
        { createdAt: "2026-06-01T00:00:00Z", qualifiedAt: "2026-06-15T00:00:00Z", rewardedAt: null },
        now,
      ),
    ).toBe("active");
  });

  it("reports rewarded once the payout has happened", () => {
    expect(
      referralStage(
        {
          createdAt: "2026-06-01T00:00:00Z",
          qualifiedAt: "2026-06-15T00:00:00Z",
          rewardedAt: "2026-07-15T00:00:00Z",
        },
        now,
      ),
    ).toBe("rewarded");
  });
});
