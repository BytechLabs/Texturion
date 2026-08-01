/**
 * #399 — the plumbing around the referral decision.
 *
 * The decision itself is tested in packages/shared. What matters here is the
 * two things this layer promises, both of which are about NOT breaking
 * something more important than a referral:
 *
 *  1. A bad code never blocks a signup. A customer who arrives without
 *     attribution is a customer we still have.
 *  2. Referral bookkeeping never fails a text that already went out.
 */
import { describe, expect, it, vi } from "vitest";

import {
  attributeReferral,
  ensureReferralCode,
  qualifyReferralForSender,
} from "./referrals";

const COMPANY = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const REFERRER = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeDb(options: {
  facts?: unknown;
  record?: string;
  qualify?: unknown;
  qualifyError?: string;
  existingCode?: string | null;
  updateReturns?: unknown[];
} = {}) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "referral_claim_facts") {
        return { data: options.facts ?? null, error: null };
      }
      if (fn === "record_referral") {
        return { data: { outcome: options.record ?? "recorded" }, error: null };
      }
      if (fn === "qualify_referral") {
        if (options.qualifyError) {
          return { data: null, error: { message: options.qualifyError } };
        }
        return { data: options.qualify ?? { outcome: "noop" }, error: null };
      }
      return { data: null, error: null };
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({
            data:
              options.existingCode === undefined
                ? [{ referral_code: null }]
                : [{ referral_code: options.existingCode }],
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          is: () => ({
            select: async () => ({
              data: options.updateReturns ?? [{ referral_code: "ABCDEFGH" }],
              error: null,
            }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("#399 ensureReferralCode", () => {
  it("returns the existing code without minting another", async () => {
    const db = fakeDb({ existingCode: "HJKMNPQR" });
    await expect(ensureReferralCode(db, COMPANY)).resolves.toBe("HJKMNPQR");
  });

  it("mints one on first use", async () => {
    // Lazy rather than at company creation: most workspaces never open the
    // referral screen, and a column populated for everybody is one that has to
    // be backfilled and kept unique for no reason.
    const db = fakeDb({ existingCode: null });
    const code = await ensureReferralCode(db, COMPANY);
    expect(code).toHaveLength(8);
  });
});

describe("#399 attributeReferral", () => {
  const facts = {
    referrer_company_id: REFERRER,
    referrer_owner_user_id: "user-a",
    referrer_rewards_this_year: 0,
    referee_already_referred: false,
  };

  it("records a genuine referral", async () => {
    const db = fakeDb({ facts });
    const result = await attributeReferral(db, {
      rawCode: "hjkm-npqr",
      refereeCompanyId: COMPANY,
      refereeOwnerUserId: "user-b",
    });
    expect(result.recorded).toBe(true);
    // Normalised before it reaches the database: the link may have been typed
    // from something read aloud.
    const facts_call = (db.calls as RpcCall[]).find(
      (c) => c.fn === "referral_claim_facts",
    );
    expect(facts_call?.args.p_code).toBe("HJKMNPQR");
  });

  it("refuses a mistyped code WITHOUT touching the database", async () => {
    // The alphabet excludes every confusable character precisely so a code
    // containing one is known to be wrong. Guessing at a neighbour could credit
    // a stranger's referral to somebody who never made it.
    const db = fakeDb({ facts });
    const result = await attributeReferral(db, {
      rawCode: "ABCDEFGO",
      refereeCompanyId: COMPANY,
      refereeOwnerUserId: "user-b",
    });
    expect(result).toEqual({ recorded: false, refusal: "not_a_code" });
    expect(db.calls).toHaveLength(0);
  });

  it("returns a refusal for an unknown code rather than raising", async () => {
    // A signup blocked on a typo is a customer we do not have.
    const db = fakeDb({ facts: null });
    await expect(
      attributeReferral(db, {
        rawCode: "HJKMNPQR",
        refereeCompanyId: COMPANY,
        refereeOwnerUserId: "user-b",
      }),
    ).resolves.toEqual({ recorded: false, refusal: "unknown_code" });
  });

  it("refuses a self-referral before writing anything", async () => {
    const db = fakeDb({ facts });
    const result = await attributeReferral(db, {
      rawCode: "HJKMNPQR",
      refereeCompanyId: COMPANY,
      // The SAME human as the referring workspace's owner.
      refereeOwnerUserId: "user-a",
    });
    expect(result).toEqual({ recorded: false, refusal: "self_referral" });
    expect((db.calls as RpcCall[]).some((c) => c.fn === "record_referral")).toBe(false);
  });

  it("reports the database's answer when it loses the insert race", async () => {
    // Two signups claiming the same referee both pass the decision; the unique
    // index decides, and the loser is told so rather than reporting success.
    const db = fakeDb({ facts, record: "already_referred" });
    const result = await attributeReferral(db, {
      rawCode: "HJKMNPQR",
      refereeCompanyId: COMPANY,
      refereeOwnerUserId: "user-b",
    });
    expect(result).toEqual({ recorded: false, refusal: "already_referred" });
  });
});

describe("#399 qualifyReferralForSender", () => {
  it("reports the transition so a reward is issued once", async () => {
    const db = fakeDb({
      qualify: { outcome: "qualified", referrer_company_id: REFERRER },
    });
    await expect(qualifyReferralForSender(db, COMPANY)).resolves.toEqual({
      qualified: true,
      referrerCompanyId: REFERRER,
    });
  });

  it("is a no-op on every send after the first", async () => {
    const db = fakeDb({ qualify: { outcome: "noop" } });
    await expect(qualifyReferralForSender(db, COMPANY)).resolves.toEqual({
      qualified: false,
    });
  });

  it("swallows a failure rather than failing a text that already went out", async () => {
    // This runs on the send path. A referral bookkeeping problem must never be
    // able to break a customer's message, so the error is logged and the send
    // stands.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ qualifyError: "connection reset" });
    await expect(qualifyReferralForSender(db, COMPANY)).resolves.toEqual({
      qualified: false,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
