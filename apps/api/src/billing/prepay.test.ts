/**
 * #400 / D106 — a year bought up front, held as Stripe customer credit.
 *
 * Two things carry real money and get most of the attention here:
 *
 *  1. The grant is IDEMPOTENT. Our webhook re-dispatches any handler that
 *     threw, every five minutes, forever — `stripe.test.ts` pins that on
 *     purpose — and `customers.createBalanceTransaction` is not idempotent. A
 *     second delivery that credited again would hand a customer a free year,
 *     silently, in our loss.
 *  2. We credit what was COLLECTED, never the list price. A promotion code
 *     changes the amount, and crediting the catalog figure for a discounted
 *     payment is money we never took.
 *
 * The rest pins the eligibility rules D106 committed to: after activation, and
 * never to a workspace whose card just failed.
 */
import { describe, expect, it, vi } from "vitest";

import { completeEnv } from "../test/support";
import {
  PREPAY_METADATA_FIELD,
  PREPAY_METADATA_KIND,
  grantPrepayment,
  isPrepayCheckout,
  prepayEligibility,
} from "./prepay";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";

type Session = Parameters<typeof isPrepayCheckout>[0];

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    id: "cs_prepay_1",
    mode: "payment",
    client_reference_id: COMPANY_ID,
    customer: "cus_1",
    amount_total: 29_000,
    currency: "usd",
    metadata: {
      [PREPAY_METADATA_FIELD]: PREPAY_METADATA_KIND,
      loonext_plan: "starter",
    },
    ...overrides,
  } as unknown as Session;
}

/** A Supabase stand-in: records rpc calls and replays scripted outcomes. */
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeDb(options: {
  claim?: string;
  hasSent?: boolean;
  claimError?: string;
} = {}) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_prepayment") {
        if (options.claimError) return { data: null, error: { message: options.claimError } };
        return { data: { outcome: options.claim ?? "claimed" }, error: null };
      }
      return { data: null, error: null };
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              limit: async () => ({
                data: options.hasSent === false ? [] : [{ id: "m1" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("#400 isPrepayCheckout", () => {
  it("claims a payment session that carries our marker", () => {
    expect(isPrepayCheckout(session())).toBe(true);
  });

  it("does NOT claim a subscription checkout", () => {
    expect(isPrepayCheckout(session({ mode: "subscription" }))).toBe(false);
  });

  it("does NOT claim an unmarked one-time session", () => {
    // The reason this checks metadata and not just `mode`: any future one-time
    // Checkout Session this product grows would otherwise be treated as a
    // prepayment and silently credited.
    expect(isPrepayCheckout(session({ metadata: {} }))).toBe(false);
    expect(isPrepayCheckout(session({ metadata: null }))).toBe(false);
  });
});

describe("#400 prepayEligibility", () => {
  const company = {
    id: COMPANY_ID,
    plan: "starter" as const,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
  };

  it("offers a year to an active workspace that has sent something", async () => {
    const result = await prepayEligibility(env, fakeDb(), company);
    expect(result.eligible).toBe(true);
    expect(result.priceCents).toBe(29_000);
  });

  it("refuses before the first message is sent", async () => {
    // D106 and #400's own sequencing insight: asking somebody to pre-pay twelve
    // months before they have sent a single text, on a product that may still
    // be waiting on carrier approval, extracts the most when the customer has
    // received the least.
    const result = await prepayEligibility(env, fakeDb({ hasSent: false }), company);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_activated");
  });

  it("refuses a workspace whose payment already failed", async () => {
    // Selling a year beside the past-due notice is both tasteless and the least
    // likely money in the product to actually clear.
    for (const status of ["past_due", "unpaid", "canceled", null]) {
      const result = await prepayEligibility(env, fakeDb(), {
        ...company,
        subscription_status: status,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("subscription_unhealthy");
    }
  });

  it("refuses when there is no subscription to prepay for", async () => {
    const result = await prepayEligibility(env, fakeDb(), {
      ...company,
      plan: null,
      stripe_subscription_id: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no_subscription");
  });

  it("refuses when the catalog has no price — the feature flag", async () => {
    // Unset price id = the offer does not exist. A surface that sells something
    // we cannot charge for is worse than no surface.
    const bare = { ...env, STRIPE_STARTER_YEAR_PRICE_ID: undefined };
    const result = await prepayEligibility(bare, fakeDb(), company);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_provisioned");
  });

  it("prices Pro higher than Starter, both at ten months for twelve", async () => {
    const starter = await prepayEligibility(env, fakeDb(), company);
    const pro = await prepayEligibility(env, fakeDb(), { ...company, plan: "pro" });
    expect(starter.priceCents).toBe(29_000);
    expect(pro.priceCents).toBe(79_000);
  });
});

describe("#400 grantPrepayment", () => {
  function stripeStub() {
    const created: { customer: string; params: Record<string, unknown> }[] = [];
    const createBalanceTransaction = vi.fn(
      async (customer: string, params: Record<string, unknown>) => {
        created.push({ customer, params });
        return { id: "cbtxn_1" };
      },
    );
    return { created, createBalanceTransaction };
  }

  async function withStripe<T>(
    stub: ReturnType<typeof stripeStub>,
    run: () => Promise<T>,
  ): Promise<T> {
    const mod = await import("./stripe");
    const spy = vi.spyOn(mod, "getStripe").mockReturnValue({
      customers: { createBalanceTransaction: stub.createBalanceTransaction },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it("credits the amount COLLECTED, as a negative balance", async () => {
    const stub = stripeStub();
    const db = fakeDb();
    const result = await withStripe(stub, () =>
      grantPrepayment(env, db, session({ amount_total: 24_650 })),
    );

    expect(result.outcome).toBe("granted");
    expect(stub.created).toHaveLength(1);
    // Negative = credit. And 24,650 rather than the 29,000 list price: a promo
    // code changes what we took, and crediting the catalog figure would hand
    // out money we never received.
    expect(stub.created[0].params.amount).toBe(-24_650);
    expect(stub.created[0].customer).toBe("cus_1");
  });

  it("grants ONCE across a replayed delivery", async () => {
    // The failure this prevents: the sweeper re-dispatches any handler that
    // threw, every five minutes. A non-idempotent credit would compound.
    const stub = stripeStub();
    const db = fakeDb({ claim: "duplicate" });
    const result = await withStripe(stub, () => grantPrepayment(env, db, session()));

    expect(result.outcome).toBe("duplicate");
    expect(stub.created).toHaveLength(0);
  });

  it("claims BEFORE calling Stripe, so a crash cannot double-credit", async () => {
    const stub = stripeStub();
    const db = fakeDb();
    await withStripe(stub, () => grantPrepayment(env, db, session()));
    // Ordering is the whole safety argument: the row exists before the money
    // moves, so a second delivery is stopped by the row rather than by luck.
    expect((db.calls as RpcCall[])[0].fn).toBe("claim_prepayment");
    expect((db.calls as RpcCall[]).some((c: RpcCall) => c.fn === "stamp_prepayment")).toBe(true);
  });

  it("withdraws the claim when Stripe refuses, so a retry can work", async () => {
    const stub = stripeStub();
    stub.createBalanceTransaction.mockRejectedValueOnce(new Error("card_declined"));
    const db = fakeDb();

    await expect(
      withStripe(stub, () => grantPrepayment(env, db, session())),
    ).rejects.toThrow("card_declined");
    // Without this the claim would block the retry forever and the customer
    // would have paid for a year they never received.
    expect((db.calls as RpcCall[]).some((c: RpcCall) => c.fn === "withdraw_prepayment")).toBe(true);
    expect((db.calls as RpcCall[]).some((c: RpcCall) => c.fn === "stamp_prepayment")).toBe(false);
  });

  it("refuses a session that collected nothing", async () => {
    const stub = stripeStub();
    await expect(
      withStripe(stub, () => grantPrepayment(env, fakeDb(), session({ amount_total: 0 }))),
    ).rejects.toThrow(/collected nothing/);
  });

  it("refuses a session with no company or no customer", async () => {
    const stub = stripeStub();
    await expect(
      withStripe(stub, () =>
        grantPrepayment(env, fakeDb(), session({ client_reference_id: null })),
      ),
    ).rejects.toThrow(/client_reference_id/);
    await expect(
      withStripe(stub, () => grantPrepayment(env, fakeDb(), session({ customer: null }))),
    ).rejects.toThrow(/no customer/);
  });
});
