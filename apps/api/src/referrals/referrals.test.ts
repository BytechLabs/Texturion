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

import { completeEnv } from "../test/support";
import {
  attributeReferral,
  ensureReferralCode,
  payPendingReferralRewards,
  qualifyReferralForSender,
  rewardQualifiedReferral,
} from "./referrals";

const env = completeEnv();
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
      // No referral_id/referee id, so the payout leg is skipped and this test
      // stays about the transition itself. The payout has its own coverage.
      qualify: { outcome: "qualified", referrer_company_id: REFERRER },
    });
    await expect(qualifyReferralForSender(env, db, COMPANY)).resolves.toEqual({
      qualified: true,
      referrerCompanyId: REFERRER,
    });
  });

  it("is a no-op on every send after the first", async () => {
    const db = fakeDb({ qualify: { outcome: "noop" } });
    await expect(qualifyReferralForSender(env, db, COMPANY)).resolves.toEqual({
      qualified: false,
    });
  });

  it("swallows a failure rather than failing a text that already went out", async () => {
    // This runs on the send path. A referral bookkeeping problem must never be
    // able to break a customer's message, so the error is logged and the send
    // stands.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ qualifyError: "connection reset" });
    await expect(qualifyReferralForSender(env, db, COMPANY)).resolves.toEqual({
      qualified: false,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("#399 rewardQualifiedReferral", () => {
  /** A subscription carrying `licensed` as its non-metered line. */
  function subscriptionOn(licensed: string) {
    return {
      id: "sub_1",
      items: {
        data: [
          { id: "si_licensed", price: { id: licensed }, discounts: [] },
          { id: "si_metered", price: { id: env.STRIPE_STARTER_OVERAGE_PRICE_ID } },
        ],
      },
    };
  }

  function stripeStub(subscription: unknown = subscriptionOn(env.STRIPE_STARTER_PRICE_ID)) {
    const updates: { id: string; params: Record<string, unknown> }[] = [];
    return {
      updates,
      api: {
        subscriptions: {
          retrieve: vi.fn(async () => subscription),
          update: vi.fn(async (id: string, params: Record<string, unknown>) => {
            updates.push({ id, params });
            return {};
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };
  }

  function subDb() {
    const calls: RpcCall[] = [];
    return {
      calls,
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: { outcome: "stamped" }, error: null };
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [{ stripe_subscription_id: "sub_1" }],
              error: null,
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  async function withStripe<T>(stub: ReturnType<typeof stripeStub>, run: () => Promise<T>) {
    const mod = await import("../billing/stripe");
    const spy = vi.spyOn(mod, "getStripe").mockReturnValue(stub.api);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it("discounts the LICENSED line only, for both sides", async () => {
    // A subscription-level coupon would make the metered overage free too —
    // and that overage is a carrier cost we have already paid. A free month
    // covers the plan fee and nothing else.
    const stub = stripeStub();
    const db = subDb();
    await withStripe(stub, () =>
      rewardQualifiedReferral(env, db, {
        referralId: "ref-1",
        referrerCompanyId: REFERRER,
        refereeCompanyId: COMPANY,
      }),
    );
    expect(stub.updates).toHaveLength(2);
    for (const update of stub.updates) {
      const items = update.params.items as { id: string; discounts: unknown }[];
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("si_licensed");
      expect(items[0].discounts).toEqual([
        { coupon: env.STRIPE_REFERRAL_MONTH_COUPON_ID },
      ]);
    }
    // Each side is stamped separately, so a half-completed payout is visible.
    const sides = (db.calls as RpcCall[])
      .filter((c) => c.fn === "stamp_referral_reward")
      .map((c) => c.args.p_side);
    expect(sides).toEqual(["referrer", "referee"]);
  });

  it("pays nobody when the coupon is not provisioned", async () => {
    // The honest half-state: referrals record and display, but nothing pays out
    // until the catalog is complete.
    const stub = stripeStub();
    const db = subDb();
    await withStripe(stub, () =>
      rewardQualifiedReferral(
        { ...env, STRIPE_REFERRAL_MONTH_COUPON_ID: undefined },
        db,
        { referralId: "ref-1", referrerCompanyId: REFERRER, refereeCompanyId: COMPANY },
      ),
    );
    expect(stub.updates).toHaveLength(0);
  });

  it("#277 HOLDS the month when the workspace is paused, and leaves it unstamped", async () => {
    // A paused workspace's licensed item is priced at the ~$5 holding fee, so a
    // free month applied now buys the customer a hold instead of the $29/$79
    // plan month they earned. Nothing here can tell that apart from a healthy
    // workspace — `companies.plan` is intact and the subscription is active — so
    // the pause price on the item is the only signal there is.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stub = stripeStub(subscriptionOn(env.STRIPE_PAUSE_PRICE_ID as string));
    const db = subDb();
    await withStripe(stub, () =>
      rewardQualifiedReferral(env, db, {
        referralId: "ref-1",
        referrerCompanyId: REFERRER,
        refereeCompanyId: COMPANY,
      }),
    );
    expect(stub.updates).toHaveLength(0);
    // Unstamped is what makes it RECOVERABLE. A stamp here would record a month
    // as paid that was never worth anything, and nothing would ever pay it.
    expect((db.calls as RpcCall[]).some((c) => c.fn === "stamp_referral_reward")).toBe(
      false,
    );
    spy.mockRestore();
  });

  it("HOLDS the month while a prepaid year rides the same item, and leaves it unstamped", async () => {
    /**
     * The write is `discounts: [{ coupon }]`, and a POPULATED array REPLACES.
     * (An EMPTY one does not clear — it is ignored — which is why
     * `clearItemDiscounts` sends the empty string.) A prepaid year is a
     * 100%-off/12-month coupon on this exact
     * item, so paying the reward here DELETES it: the customer keeps being billed
     * the full plan price for months they already paid for, up to $790, while
     * `prepayments.granted_through` still records them as covered.
     *
     * `itemHasDiscount` cannot see this — it is asked only about the referral
     * coupon — which is why the check has to be separate and come first.
     *
     * Held rather than merged: with the plan line already at $0 a `duration:
     * once` coupon would be consumed against a $0 invoice and evaporate.
     */
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prepaid = subscriptionOn(env.STRIPE_STARTER_PRICE_ID);
    prepaid.items.data[0].discounts = [
      { id: "di_prepaid", coupon: { id: env.STRIPE_PREPAID_YEAR_COUPON_ID } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const stub = stripeStub(prepaid);
    const db = subDb();
    await withStripe(stub, () =>
      rewardQualifiedReferral(env, db, {
        referralId: "ref-1",
        referrerCompanyId: REFERRER,
        refereeCompanyId: COMPANY,
      }),
    );
    expect(stub.updates).toHaveLength(0);
    // Unstamped is what makes it recoverable: `payPendingReferralRewards` retries
    // unstamped qualified rows behind every send, so the month lands by itself
    // once the year ends.
    expect((db.calls as RpcCall[]).some((c) => c.fn === "stamp_referral_reward")).toBe(
      false,
    );
    spy.mockRestore();
  });

  it("still pays the referee when the referrer's side fails", async () => {
    // A referrer who has since cancelled must not cost the referee the month
    // they earned by actually using the product.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stripeStub();
    stub.api.subscriptions.retrieve
      .mockRejectedValueOnce(new Error("no such subscription"));
    const db = subDb();
    await withStripe(stub, () =>
      rewardQualifiedReferral(env, db, {
        referralId: "ref-1",
        referrerCompanyId: REFERRER,
        refereeCompanyId: COMPANY,
      }),
    );
    expect(stub.updates).toHaveLength(1);
    expect(
      (db.calls as RpcCall[]).filter((c) => c.fn === "stamp_referral_reward")
        .map((c) => c.args.p_side),
    ).toEqual(["referee"]);
    spy.mockRestore();
  });

  /**
   * #277 — the other half of the pause.
   *
   * `rewardSide` refusing to spend a free month on a holding fee is only half a
   * decision: nothing in this product sweeps unstamped rewards, so without a
   * retry "paid on resume" would be a comment rather than a behaviour, and the
   * month would be lost exactly as surely as if it had been spent.
   */
  describe("payPendingReferralRewards", () => {
    /** Records the PostgREST filters, so the scoping can be asserted. */
    function pendingDb(rows: Record<string, unknown>[], answer?: unknown) {
      const calls: RpcCall[] = [];
      const filters: [string, unknown][] = [];
      const referrals = {
        select: () => referrals,
        eq: (column: string, value: unknown) => {
          filters.push([`eq:${column}`, value]);
          return referrals;
        },
        not: (column: string, op: string, value: unknown) => {
          filters.push([`not:${column}.${op}`, value]);
          return referrals;
        },
        is: (column: string, value: unknown) => {
          filters.push([`is:${column}`, value]);
          return referrals;
        },
        then: (resolve: (r: unknown) => void) =>
          resolve(answer ?? { data: rows, error: null }),
      };
      return {
        calls,
        filters,
        rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return { data: { outcome: "stamped" }, error: null };
        }),
        from: (table: string) =>
          table === "referrals"
            ? referrals
            : {
                select: () => ({
                  eq: () => ({
                    limit: async () => ({
                      data: [{ stripe_subscription_id: "sub_1" }],
                      error: null,
                    }),
                  }),
                }),
              },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    it("pays the month the resumed workspace earned while it was paused", async () => {
      const stub = stripeStub();
      const db = pendingDb([{ id: "ref-1" }]);
      await expect(
        withStripe(stub, () => payPendingReferralRewards(env, db, REFERRER)),
      ).resolves.toBe(1);

      expect(stub.updates).toHaveLength(1);
      const items = stub.updates[0].params.items as { id: string; discounts: unknown }[];
      expect(items[0].id).toBe("si_licensed");
      expect(items[0].discounts).toEqual([
        { coupon: env.STRIPE_REFERRAL_MONTH_COUPON_ID },
      ]);
      const stamps = (db.calls as RpcCall[]).filter(
        (c) => c.fn === "stamp_referral_reward",
      );
      expect(stamps.map((c) => c.args.p_side)).toEqual(["referrer"]);
    });

    it("pays ONE month per call, and leaves the rest owed rather than spent", async () => {
      // A referrer away for the winter can come back to several qualified
      // referrals at once. The coupon is `duration: once` and `rewardSide`
      // writes `discounts: [{ coupon }]`, which REPLACES the item's discounts —
      // so a second one applied before the first reaches an invoice is the same
      // month written twice, not two months. Walking the whole list stamped
      // every row while Stripe held one coupon: three referrals earned, one
      // month delivered, three recorded as paid and none recoverable.
      //
      // This stub answers `retrieve` with what the updates actually did, which
      // is what makes the over-stamp visible at all — a frozen subscription
      // reports a clean discount-free item forever and every row "succeeds".
      const applied: unknown[] = [];
      const live = {
        id: "sub_1",
        items: {
          data: [
            {
              id: "si_licensed",
              price: { id: env.STRIPE_STARTER_PRICE_ID },
              get discounts() {
                return applied;
              },
            },
          ],
        },
      };
      const stub = stripeStub(live);
      stub.api.subscriptions.update = vi.fn(
        async (id: string, params: Record<string, unknown>) => {
          stub.updates.push({ id, params });
          applied.push({ id: "di_1", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } });
          return {};
        },
      );
      const db = pendingDb([{ id: "ref-1" }, { id: "ref-2" }, { id: "ref-3" }]);

      await expect(
        withStripe(stub, () => payPendingReferralRewards(env, db, REFERRER)),
      ).resolves.toBe(1);

      expect(stub.updates).toHaveLength(1);
      const stamps = (db.calls as RpcCall[]).filter(
        (c) => c.fn === "stamp_referral_reward",
      );
      // One coupon, ONE stamp. The other two rows keep their null timestamps,
      // which is what "still owed" is recorded as everywhere else here.
      expect(stamps).toHaveLength(1);
      expect(stamps[0].args.p_referral_id).toBe("ref-1");
    });

    it("asks only for THIS company's own qualified, unpaid, unvoided referrals", async () => {
      // Tenant-scoped on the referrer column, which is what owns the row. The
      // referee side is deliberately not read: a referee's month is earned by an
      // accepted outbound send, and a paused workspace cannot send, so it can
      // never be the side a pause held back — and reading it would mean
      // selecting rows belonging to another tenant.
      const stub = stripeStub();
      const db = pendingDb([]);
      await withStripe(stub, () => payPendingReferralRewards(env, db, REFERRER));
      expect(db.filters).toEqual([
        ["eq:company_id", REFERRER],
        ["not:qualified_at.is", null],
        ["is:voided_at", null],
        ["is:referrer_rewarded_at", null],
      ]);
    });

    it("swallows a lookup failure rather than 500ing a resume that already charged", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const db = pendingDb([], { data: null, error: { message: "connection reset" } });
      await expect(payPendingReferralRewards(env, db, REFERRER)).resolves.toBe(0);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
