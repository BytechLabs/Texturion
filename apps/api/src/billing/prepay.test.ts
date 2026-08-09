/**
 * #400 / D107 — the prepaid year.
 *
 * A design review raised 21 defects against this mechanism and confirmed 12.
 * Each one that cost money has an assertion here, because the two things that
 * make this feature dangerous are both invisible in a happy-path test:
 *
 *  1. Re-applying the coupon RESTARTS its twelve months. One payment could buy
 *     unbounded free service, and a transient failure does it by accident.
 *  2. A claim that commits without its response being seen is the case that
 *     silently ate a payment in the first attempt at this feature.
 */
import { BILLING_CURRENCIES, PLAN_PRICE_CENTS } from "@loonext/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeEnv } from "../test/support";
import {
  PLAN_PREPAY_YEAR_CENTS,
  PREPAY_MONTHS,
  PREPAY_MONTHS_CHARGED,
} from "./plans";
import {
  PREPAY_METADATA_FIELD,
  PREPAY_METADATA_KIND,
  PREPAY_PLAN_FIELD,
  amortisedMonthlyUsdCents,
  grantPrepaidYear,
  isPrepayCheckout,
  itemHasDiscount,
  ensurePrepaidDiscount,
  itemHasPrepaidCoupon,
  prepaidCouponIds,
  prepaidCouponPending,
  prepaidRemainderCouponId,
  prepayEligibility,
  remainingPrepaidInvoices,
  revokePrepaidYear,
  sweepUncreditedConversions,
} from "./prepay";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const COUPON = env.STRIPE_PREPAID_YEAR_COUPON_ID as string;

type Session = Parameters<typeof isPrepayCheckout>[0];

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    id: "cs_prepay_1",
    mode: "payment",
    client_reference_id: COMPANY_ID,
    customer: "cus_1",
    payment_intent: "pi_1",
    amount_total: 29_000,
    currency: "usd",
    metadata: {
      [PREPAY_METADATA_FIELD]: PREPAY_METADATA_KIND,
      [PREPAY_PLAN_FIELD]: "starter",
    },
    ...overrides,
  } as unknown as Session;
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** A Supabase stand-in: records rpc calls and replays scripted outcomes. */
function fakeDb(
  options: { claim?: string; hasSent?: boolean; open?: unknown } = {},
) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_prepayment") {
        return { data: { outcome: options.claim ?? "claimed" }, error: null };
      }
      if (fn === "open_prepayment") {
        return { data: options.open ?? null, error: null };
      }
      return { data: null, error: null };
    }),
    from: (table: string) => ({
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
          limit: async () => ({
            data:
              table === "companies"
                ? [{ stripe_subscription_id: "sub_1" }]
                : [{ id: "m1" }],
            error: null,
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function subscriptionWith(discounts: unknown[] = []) {
  return {
    id: "sub_1",
    schedule: null,
    items: {
      data: [
        {
          id: "si_licensed",
          price: { id: env.STRIPE_STARTER_PRICE_ID },
          discounts,
        },
        { id: "si_metered", price: { id: env.STRIPE_STARTER_OVERAGE_PRICE_ID } },
      ],
    },
  };
}

function stripeStub(
  subscription: unknown = subscriptionWith(),
  /**
   * #522 — what the year price can be charged in. `undefined` means the CAD
   * option has not been filed, which is the live state before an operator runs
   * `stripe:setup`.
   */
  priceCurrencyOptions?: Record<string, unknown>,
) {
  const updates: { id: string; params: Record<string, unknown> }[] = [];
  return {
    updates,

    api: {
      subscriptions: {
        retrieve: vi.fn(async () => subscription),
        update: vi.fn(async (id: string, params: Record<string, unknown>) => {
          updates.push({ id, params });
          return subscription;
        }),
      },
      prices: {
        retrieve: vi.fn(async () => ({
          currency: "usd",
          currency_options: priceCurrencyOptions ?? {},
        })),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

async function withStripe<T>(stub: ReturnType<typeof stripeStub>, run: () => Promise<T>) {
  const mod = await import("./stripe");
  const spy = vi.spyOn(mod, "getStripe").mockReturnValue(stub.api);
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

describe("#400 isPrepayCheckout", () => {
  it("claims a payment session carrying our marker", () => {
    expect(isPrepayCheckout(session())).toBe(true);
  });

  it("does NOT claim a subscription checkout or an unmarked one-time session", () => {
    // Metadata rather than mode alone: any future one-time session this product
    // grows would otherwise be treated as a year and silently granted.
    expect(isPrepayCheckout(session({ mode: "subscription" }))).toBe(false);
    expect(isPrepayCheckout(session({ metadata: {} }))).toBe(false);
    expect(isPrepayCheckout(session({ metadata: null }))).toBe(false);
  });
});

describe("#400 eligibility", () => {
  const company = {
    id: COMPANY_ID,
    plan: "starter" as const,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
  };

  it("offers a year to an active workspace that has sent something", async () => {
    const r = await prepayEligibility(env, fakeDb(), company, subscriptionWith() as never);
    expect(r.eligible).toBe(true);
    expect(r.priceCents).toBe(29_000);
  });

  it("refuses before the first message is sent", async () => {
    const r = await prepayEligibility(
      env,
      fakeDb({ hasSent: false }),
      company,
      subscriptionWith() as never,
    );
    expect(r).toMatchObject({ eligible: false, reason: "not_activated" });
  });

  it("refuses a workspace whose payment already failed", async () => {
    for (const status of ["past_due", "unpaid", "canceled", null]) {
      const r = await prepayEligibility(
        env,
        fakeDb(),
        { ...company, subscription_status: status },
        subscriptionWith() as never,
      );
      expect(r).toMatchObject({ eligible: false, reason: "subscription_unhealthy" });
    }
  });

  it("refuses while a plan change is scheduled", async () => {
    // Stripe rejects item writes while a schedule owns the items, so a grant
    // here fails after five sweeper retries with the money already taken.
    const scheduled = { ...subscriptionWith(), schedule: "sub_sched_1" };
    const r = await prepayEligibility(env, fakeDb(), company, scheduled as never);
    expect(r).toMatchObject({ eligible: false, reason: "plan_change_pending" });
  });

  it("refuses a SECOND year while one is running", async () => {
    // A second coupon on the same item does not add twelve months to the first.
    const open = {
      session_id: "cs_old",
      plan: "starter",
      amount_cents: 29_000,
      months_granted: 12,
      granted_at: "2026-01-01T00:00:00Z",
      granted_through: "2027-01-01T00:00:00Z",
      discount_id: COUPON,
    };
    const r = await prepayEligibility(
      env,
      fakeDb({ open }),
      company,
      subscriptionWith() as never,
    );
    expect(r).toMatchObject({ eligible: false, reason: "already_prepaid" });
    expect(r.open?.granted_through).toBe("2027-01-01T00:00:00Z");
  });

  it("refuses while an unspent REFERRAL month rides the same item", async () => {
    /**
     * #399's free month is a 100%-off coupon on the licensed item, and
     * `grantPrepaidYear` writes `discounts: [{ coupon }]` — an array write, which
     * REPLACES. So selling the year here deletes a month the customer had
     * already earned, and once the coupon is off the item nothing can tell it
     * was ever there.
     *
     * Refused at the SELL, not patched at the grant: the grant runs after the
     * money is taken, and by then the only choices are to destroy the month or
     * to stack it on a line already discounted to $0, where a `duration: once`
     * coupon is consumed against a $0 invoice and evaporates anyway.
     *
     * `pauseEligibility` has carried this exact gate since the referral month
     * shipped, which is what makes its absence here an omission.
     */
    const withMonth = subscriptionWith([
      { id: "di_ref", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } },
    ]);
    const r = await prepayEligibility(env, fakeDb(), company, withMonth as never);
    expect(r).toMatchObject({ eligible: false, reason: "referral_month_pending" });
  });

  it("refuses when the catalog is half-provisioned — the coupon counts", async () => {
    // The coupon is as load-bearing as the price: without it the money buys
    // nothing at all.
    for (const bare of [
      { ...env, STRIPE_STARTER_YEAR_PRICE_ID: undefined },
      { ...env, STRIPE_PREPAID_YEAR_COUPON_ID: undefined },
    ]) {
      const r = await prepayEligibility(bare, fakeDb(), company, subscriptionWith() as never);
      expect(r).toMatchObject({ eligible: false, reason: "not_provisioned" });
    }
  });

  it("prices both plans at ten months for twelve", async () => {
    const starter = await prepayEligibility(env, fakeDb(), company, subscriptionWith() as never);
    const pro = await prepayEligibility(
      env,
      fakeDb(),
      { ...company, plan: "pro" },
      subscriptionWith() as never,
    );
    // The arithmetic the credit design failed: 29000 < 12 x 2900 = 34800.
    expect(starter.priceCents).toBe(29_000);
    expect(starter.priceCents! * 1).toBeLessThan(12 * 2_900);
    expect(pro.priceCents).toBe(79_000);
    expect(pro.priceCents! * 1).toBeLessThan(12 * 7_900);
  });
});

/**
 * #522 — the year is priced in the money the workspace is billed in.
 *
 * The defect: a Canadian workspace saw "$290" on a card whose entire job is to
 * take a large payment up front, and was charged US$290. Every other figure on
 * that screen was already CAD — the plan price, the cancellation answer — so
 * the one number the customer was agreeing to was the one in a foreign
 * currency, and nothing on the page said so.
 */
describe("#522 the prepaid year speaks the workspace's currency", () => {
  const canadian = {
    id: COMPANY_ID,
    plan: "starter" as const,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    billing_currency: "cad",
  };

  beforeEach(async () => {
    // The probe memoises per price id for the isolate's lifetime, so one test's
    // catalog would otherwise answer the next test's question.
    const { resetCheckoutCurrencyCache } = await import("./checkout-currency");
    resetCheckoutCurrencyCache();
  });

  it("quotes CAD once the catalog carries it", async () => {
    const stub = stripeStub(subscriptionWith(), { cad: { unit_amount: 39_000 } });
    const r = await withStripe(stub, () =>
      prepayEligibility(env, fakeDb(), canadian, subscriptionWith() as never),
    );

    expect(r.eligible).toBe(true);
    expect(r.currency).toBe("cad");
    // Ten times the DECIDED CAD monthly price ($39), not a conversion of $290
    // and not the USD figure relabelled. Deliberately unequal to both the USD
    // year (29_000) and any rounding of it, so a constant that ignored the
    // currency could not satisfy this.
    expect(r.priceCents).toBe(39_000);
  });

  /**
   * THE ONE THAT MATTERS. The live state on the day #522 was filed: the
   * workspace is CAD, the year price is USD-only, and the old code answered
   * "eligible, $290" — a figure a Canadian reads as CAD, against a charge in
   * US dollars.
   */
  it("offers NOTHING rather than a US figure the catalog cannot leave", async () => {
    const stub = stripeStub(subscriptionWith());
    const r = await withStripe(stub, () =>
      prepayEligibility(env, fakeDb(), canadian, subscriptionWith() as never),
    );

    expect(r).toMatchObject({ eligible: false, reason: "currency_unavailable" });
    // No price at all, in either currency. A refusal that still carried
    // `priceCents: 29000` would let a surface render the offer greyed out with
    // the wrong money on it.
    expect(r.priceCents).toBeUndefined();
    expect(r.currency).toBe("cad");
  });

  it("never spends a Stripe read on a USD workspace", async () => {
    const stub = stripeStub(subscriptionWith());
    const r = await withStripe(stub, () =>
      prepayEligibility(
        env,
        fakeDb(),
        { ...canadian, billing_currency: "usd" },
        subscriptionWith() as never,
      ),
    );

    expect(r).toMatchObject({ eligible: true, currency: "usd", priceCents: 29_000 });
    expect(stub.api.prices.retrieve).not.toHaveBeenCalled();
  });

  it("prices the Canadian year off the Canadian monthly price, not a conversion", () => {
    // The CAD year is not a pricing decision of its own — it is the same plan
    // bought ten months at a time, so it can never drift from the monthly
    // figure it discounts. A straight FX conversion of the USD year would be
    // ~$403 and ~$1,097, which is what "converted, not decided" looks like.
    for (const currency of BILLING_CURRENCIES) {
      for (const plan of ["starter", "pro"] as const) {
        expect(PLAN_PREPAY_YEAR_CENTS[currency][plan]).toBe(
          PLAN_PRICE_CENTS[currency][plan] * PREPAY_MONTHS_CHARGED,
        );
        // And it is still a discount in its own currency, which is the property
        // the customer-balance-credit design failed.
        expect(PLAN_PREPAY_YEAR_CENTS[currency][plan]).toBeLessThan(
          PLAN_PRICE_CENTS[currency][plan] * PREPAY_MONTHS,
        );
      }
    }
  });
});

describe("#400 grantPrepaidYear", () => {
  it("applies the coupon to the LICENSED item only", async () => {
    const stub = stripeStub();
    const db = fakeDb();
    const r = await withStripe(stub, () => grantPrepaidYear(env, db, session()));

    expect(r.outcome).toBe("granted");
    expect(stub.updates).toHaveLength(1);
    const items = stub.updates[0].params.items as { id: string; discounts: unknown }[];
    // Only the licensed line. A subscription-level coupon would zero the metered
    // overage too, making every text free.
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("si_licensed");
    expect(items[0].discounts).toEqual([{ coupon: COUPON }]);
  });

  it("claims BEFORE calling Stripe, so a crash cannot double-grant", async () => {
    const stub = stripeStub();
    const db = fakeDb();
    await withStripe(stub, () => grantPrepaidYear(env, db, session()));
    expect((db.calls as RpcCall[])[0].fn).toBe("claim_prepayment");
    expect((db.calls as RpcCall[]).some((c) => c.fn === "stamp_prepayment")).toBe(true);
  });

  it("does NOTHING on a replay of an already-granted session", async () => {
    // The failure this prevents: re-applying the coupon RESTARTS its twelve
    // months, so a replay would extend the year for free, forever.
    const stub = stripeStub();
    const r = await withStripe(stub, () =>
      grantPrepaidYear(env, fakeDb({ claim: "granted" }), session()),
    );
    expect(r.outcome).toBe("already");
    expect(stub.updates).toHaveLength(0);
  });

  it("RESUMES a claim that committed without its response being seen", async () => {
    // The bug that silently ate a payment in the first attempt: the row exists,
    // nothing was granted, and reporting "duplicate" closed the event as a
    // success. `resume` retries the grant instead.
    const stub = stripeStub();
    const r = await withStripe(stub, () =>
      grantPrepaidYear(env, fakeDb({ claim: "resume" }), session()),
    );
    expect(r.outcome).toBe("granted");
    expect(stub.updates).toHaveLength(1);
  });

  it("does not re-apply a coupon the item already carries", async () => {
    // The other half of the restart hazard: a resume whose Stripe write DID
    // land must stamp and stop, not write again.
    const stub = stripeStub(subscriptionWith([{ coupon: { id: COUPON } }]));
    const r = await withStripe(stub, () =>
      grantPrepaidYear(env, fakeDb({ claim: "resume" }), session()),
    );
    expect(r.outcome).toBe("granted");
    expect(stub.updates).toHaveLength(0);
  });

  it("CARRIES an unspent referral month through instead of deleting it", async () => {
    // The sell gate above should mean this never happens, but the money is
    // already taken by the time a grant runs, so the race gets a backstop rather
    // than a throw. Carried rather than replaced: the array write would delete a
    // month somebody earned, and that is worse than stacking it on a line about
    // to be $0 anyway.
    const stub = stripeStub(
      subscriptionWith([
        { id: "di_ref", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } },
      ]),
    );
    await withStripe(stub, () => grantPrepaidYear(env, fakeDb(), session()));
    expect(stub.updates).toHaveLength(1);
    const item = (
      stub.updates[0].params as { items: { discounts: { coupon: string }[] }[] }
    ).items[0];
    expect(item.discounts.map((d) => d.coupon)).toEqual([
      env.STRIPE_REFERRAL_MONTH_COUPON_ID,
      COUPON,
    ]);
  });

  it("refuses to re-grant a revoked year", async () => {
    const stub = stripeStub();
    const r = await withStripe(stub, () =>
      grantPrepaidYear(env, fakeDb({ claim: "revoked" }), session()),
    );
    expect(r.outcome).toBe("revoked");
    expect(stub.updates).toHaveLength(0);
  });

  it("records the amount COLLECTED and the payment intent", async () => {
    const stub = stripeStub();
    const db = fakeDb();
    await withStripe(stub, () =>
      grantPrepaidYear(env, db, session({ amount_total: 24_650 })),
    );
    const claim = (db.calls as RpcCall[])[0].args;
    // A promo code changes what we took; crediting the list price would give
    // away money we never received, and the refund figure would be wrong.
    expect(claim.p_amount_cents).toBe(24_650);
    // Without the payment intent a won chargeback cannot find the year to
    // revoke, and we would deliver ten free months on top of the clawback.
    expect(claim.p_payment_intent).toBe("pi_1");
  });

  it("refuses a session with no plan, no company, or nothing collected", async () => {
    const stub = stripeStub();
    for (const [bad, pattern] of [
      [session({ metadata: {} }), /no plan/],
      [session({ client_reference_id: null }), /client_reference_id/],
      [session({ amount_total: 0 }), /collected nothing/],
    ] as const) {
      await expect(
        withStripe(stub, () => grantPrepaidYear(env, fakeDb(), bad)),
      ).rejects.toThrow(pattern);
    }
  });
});

describe("#400 itemHasDiscount", () => {
  it("reads both the id form and the expanded form", () => {
    const item = (discounts: unknown[]) =>
      ({ discounts }) as unknown as Parameters<typeof itemHasDiscount>[0];
    // The shape Stripe actually returns: a Discount whose own id is di_..., and
    // whose `coupon` is the thing we applied. Comparing the wrong one makes a
    // landed grant look un-granted, and re-applying RESTARTS the year.
    expect(itemHasDiscount(item([{ id: "di_1", coupon: { id: COUPON } }]), COUPON)).toBe(true);
    expect(itemHasDiscount(item([{ id: "di_1", coupon: COUPON }]), COUPON)).toBe(true);
    expect(itemHasDiscount(item([COUPON]), COUPON)).toBe(true);
    expect(itemHasDiscount(item([{ id: COUPON }]), COUPON)).toBe(true);
    expect(itemHasDiscount(item([]), COUPON)).toBe(false);
    expect(itemHasDiscount(item([{ id: "di_1", coupon: { id: "other" } }]), COUPON)).toBe(false);
  });
});

describe("#400 amortisedMonthlyUsdCents", () => {
  it("values a prepaid tenant at what it actually pays", () => {
    // The underwater alert reads the plan LIST price, so a prepaid workspace
    // looks like it is paying $29 a month it is not paying — muting the one
    // alert that catches a tenant costing more than it pays, for exactly the
    // cohort that has already paid everything it ever will.
    const open = {
      session_id: "cs_1",
      plan: "starter" as const,
      amount_cents: 29_000,
      currency: "usd",
      months_granted: 12,
      granted_at: "2026-01-01T00:00:00Z",
      granted_through: "2027-01-01T00:00:00Z",
      discount_id: COUPON,
    };
    expect(amortisedMonthlyUsdCents(open, 2_900)).toBe(2_417);
    expect(amortisedMonthlyUsdCents(open, 2_900)).toBeLessThan(2_900);
  });

  it("falls back to the list price with no open window", () => {
    expect(amortisedMonthlyUsdCents(null, 2_900)).toBe(2_900);
  });

  /**
   * #522 — a CAD year must not reach the USD cost model at face value.
   *
   * The projection divides this across the months it bought and compares the
   * result against Telnyx and Cloudflare invoices in US dollars. Read as US
   * cents, CA$390 a year would report a tenant paying MORE per month than the
   * US$290 tenant on the identical plan — flattering margin on the one cohort
   * whose licensed line is invoicing at $0, which is the cohort this figure
   * exists to keep an eye on.
   */
  it("converts a Canadian year into US cents before the cost model sees it", () => {
    const cad = {
      session_id: "cs_cad",
      plan: "starter" as const,
      amount_cents: 39_000,
      currency: "cad",
      months_granted: 12,
      granted_at: "2026-01-01T00:00:00Z",
      granted_through: "2027-01-01T00:00:00Z",
      discount_id: COUPON,
    };
    // 39_000 x 0.72 / 12 = 2_340. A function that ignored `currency` returns
    // 3_250 — a figure larger than the plan's own USD list price, which is the
    // tell that a foreign number got in.
    expect(amortisedMonthlyUsdCents(cad, 2_900)).toBe(2_340);
    expect(amortisedMonthlyUsdCents(cad, 2_900)).toBeLessThan(
      Math.round(cad.amount_cents / cad.months_granted),
    );
  });
});

describe("#400 revokePrepaidYear — taking the coupon off actually takes it off", () => {
  /**
   * THE CLEAR VALUE IS THE EMPTY STRING, AND AN EMPTY ARRAY IS A NO-OP.
   *
   * This shipped as `discounts: []` and did nothing at all. Stripe's own words for
   * the parameter: "If not specified **or empty array, it leaves the discounts
   * unchanged**. If empty string, it clears them." The Node SDK's form encoder
   * drops an empty array from the request body entirely, so `items[0][discounts]`
   * never reached the wire — the call succeeded, returned a normal subscription,
   * and changed nothing.
   *
   * What it cost: a refund or a won chargeback revoked the claim row and left the
   * 100%-off coupon running, so the customer got up to eleven more free months ON
   * TOP of the money we had just given back. D107 names that as the largest single
   * loss any of these paths can produce, and it had been shipped in the one shape
   * that looks exactly like the fix.
   *
   * Nothing here could have caught it, which is the other half of the lesson: the
   * only assertion was on the params OBJECT, where `[]` reads as correct. The
   * wire-level twin lives in routes/billing.test.ts, which decodes the real
   * encoded body and asserts `items[0][discounts]` is present and empty.
   */
  function revokeDb() {
    const calls: RpcCall[] = [];
    return {
      calls,
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "revoke_prepayment") {
          return {
            data: { outcome: "revoked", company_id: COMPANY_ID },
            error: null,
          };
        }
        return { data: null, error: null };
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

  it("clears with the empty STRING, which is the only value Stripe acts on", async () => {
    const stub = stripeStub();
    const db = revokeDb();

    const result = await withStripe(stub, () =>
      revokePrepaidYear(env, db, "cs_prepay_1", "refunded"),
    );

    expect(result.outcome).toBe("revoked");
    expect(stub.updates).toHaveLength(1);
    const items = stub.updates[0].params.items as {
      id: string;
      discounts: unknown;
    }[];
    expect(items).toHaveLength(1);
    // The licensed line only. A subscription-level clear would also remove a
    // referral month somebody earned.
    expect(items[0].id).toBe("si_licensed");
    expect(items[0].discounts).toBe("");
    // Said explicitly, because `[]` is the mistake and it is not a distant one:
    // it typechecks, it reads as "no discounts", and it is what was shipped.
    expect(items[0].discounts).not.toEqual([]);
  });

  it("does nothing at Stripe when there was no year to revoke", async () => {
    const stub = stripeStub();
    const db = {
      rpc: vi.fn(async () => ({ data: { outcome: "noop" }, error: null })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await withStripe(stub, () =>
      revokePrepaidYear(env, db, "cs_never_existed", "refunded"),
    );

    expect(result.outcome).toBe("noop");
    // An ordinary refund on an ordinary subscription must not touch its discounts.
    // Most refunds are exactly that, and a referral month lives on the same item.
    expect(stub.updates).toHaveLength(0);
  });
});

describe("#583 the sweep that finishes an interrupted credit", () => {
  /**
   * D131 chose this failure on purpose: the claim row is written first, so a crash
   * afterwards leaves a customer at full price who is owed a RECORDED amount, rather
   * than a live 100%-off coupon with the entitlement already closed. Over-charging by
   * an amount we wrote down beats giving away service nobody is watching.
   *
   * That is only defensible because this runs. These are the properties that make it
   * a repair rather than a second way to pay somebody twice.
   */
  interface SweepStripe {
    credits: { customer: string; params: Record<string, unknown>; options: unknown }[];
    api: unknown;
  }

  function sweepStripe(fail?: string): SweepStripe {
    const credits: SweepStripe["credits"] = [];
    return {
      credits,
      api: {
        customers: {
          createBalanceTransaction: vi.fn(
            async (customer: string, params: Record<string, unknown>, options: unknown) => {
              if (fail === customer) throw new Error("card_declined");
              credits.push({ customer, params, options });
              return { id: `cbtxn_${credits.length}` };
            },
          ),
        },
      },
    };
  }

  function sweepDb(
    rows: Record<string, unknown>[],
    customers: Record<string, string | null>,
  ) {
    const calls: RpcCall[] = [];
    return {
      calls,
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "prepayments_awaiting_credit") return { data: rows, error: null };
        return { data: null, error: null };
      }),
      from: () => ({
        select: () => ({
          eq: (_column: string, id: string) => ({
            limit: async () => ({
              data: [{ stripe_customer_id: customers[id] ?? null }],
              error: null,
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const owed = (overrides: Record<string, unknown> = {}) => ({
    prepayment_id: "11111111-1111-4111-8111-111111111111",
    company_id: COMPANY_ID,
    currency: "usd",
    credit_cents: 21_750,
    converted_at: "2026-08-09T00:00:00Z",
    converted_to_plan: "pro",
    ...overrides,
  });

  async function withDbAndStripe<T>(
    db: unknown,
    stripe: SweepStripe,
    run: () => Promise<T>,
  ): Promise<T> {
    const stripeMod = await import("./stripe");
    const dbMod = await import("../db");
    const s = vi.spyOn(stripeMod, "getStripe").mockReturnValue(stripe.api as never);
    const d = vi.spyOn(dbMod, "getDb").mockReturnValue(db as never);
    try {
      return await run();
    } finally {
      s.mockRestore();
      d.mockRestore();
    }
  }

  it("pays what the row says it owes, as a NEGATIVE amount", async () => {
    const stripe = sweepStripe();
    const db = sweepDb([owed()], { [COMPANY_ID]: "cus_1" });

    const result = await withDbAndStripe(db, stripe, () =>
      sweepUncreditedConversions(env),
    );

    expect(result).toEqual({ credited: 1, failed: 0 });
    expect(stripe.credits).toHaveLength(1);
    // Stripe: "a negative value is a credit for the customer's balance, and a
    // positive value is a debit". Positive here would BILL somebody the value of
    // the year they had already paid for — a repair job that charges the customer.
    expect(stripe.credits[0].params.amount).toBe(-21_750);
    expect(stripe.credits[0].params.currency).toBe("usd");
    expect(stripe.credits[0].customer).toBe("cus_1");
  });

  it("uses the SAME idempotency key as the inline attempt", async () => {
    // The whole safety of having two writers. A sweep racing a retry of the original
    // request hands Stripe the same key, and Stripe returns the first transaction
    // instead of creating a second. Without this the repair is a double payment.
    const stripe = sweepStripe();
    const db = sweepDb([owed()], { [COMPANY_ID]: "cus_1" });

    await withDbAndStripe(db, stripe, () => sweepUncreditedConversions(env));

    expect(stripe.credits[0].options).toEqual({
      idempotencyKey: "prepay-credit:11111111-1111-4111-8111-111111111111",
    });
  });

  it("records that it paid, so the next pass leaves it alone", async () => {
    const stripe = sweepStripe();
    const db = sweepDb([owed()], { [COMPANY_ID]: "cus_1" });

    await withDbAndStripe(db, stripe, () => sweepUncreditedConversions(env));

    const stamp = (db.calls as RpcCall[]).find(
      (call) => call.fn === "stamp_prepayment_credit",
    );
    expect(stamp?.args).toEqual({
      p_prepayment_id: "11111111-1111-4111-8111-111111111111",
      p_txn: "cbtxn_1",
    });
  });

  it("one bad row does not hold up the others", async () => {
    // A company whose Stripe customer went away would otherwise block every
    // conversion queued behind it, forever, and the queue is money we owe.
    const stripe = sweepStripe();
    const db = sweepDb(
      [
        owed({ prepayment_id: "aaaaaaaa-1111-4111-8111-111111111111", company_id: "co_a" }),
        owed({ prepayment_id: "bbbbbbbb-1111-4111-8111-111111111111", company_id: "co_b" }),
      ],
      { co_a: null, co_b: "cus_b" },
    );

    const result = await withDbAndStripe(db, stripe, () =>
      sweepUncreditedConversions(env),
    );

    expect(result).toEqual({ credited: 1, failed: 1 });
    expect(stripe.credits).toHaveLength(1);
    expect(stripe.credits[0].customer).toBe("cus_b");
    // The failed one is NOT stamped, so it stays in the set for the next pass.
    const stamps = (db.calls as RpcCall[]).filter(
      (call) => call.fn === "stamp_prepayment_credit",
    );
    expect(stamps).toHaveLength(1);
  });

  it("costs one query on the overwhelming majority of ticks", async () => {
    // It runs every fifteen minutes forever and the set is empty almost always.
    const stripe = sweepStripe();
    const db = sweepDb([], {});

    const result = await withDbAndStripe(db, stripe, () =>
      sweepUncreditedConversions(env),
    );

    expect(result).toEqual({ credited: 0, failed: 0 });
    expect(stripe.credits).toHaveLength(0);
    expect(db.calls).toHaveLength(1);
  });
});

describe("#584 the prepaid coupon family", () => {
  /**
   * Once a re-asserted year can wear a SHORTER coupon, every question of the form
   * "is a prepaid year on this subscription?" has twelve right answers instead of
   * one. Each place still asking about the base id alone would answer NO for a
   * repaired year — switching off the change-plan orphan backstop and the pause
   * gate for exactly the customers the convergence had just made whole.
   */
  it("derives twelve ids from one setting, and twelve months IS the base", () => {
    // Not a thirteenth id for the full year: two ids meaning the same thing is two
    // things every predicate has to know, and one of them will get forgotten.
    expect(prepaidRemainderCouponId(env, 12)).toBe(COUPON);
    expect(prepaidRemainderCouponId(env, 9)).toBe(`${COUPON}_remainder_9`);
    expect(prepaidRemainderCouponId(env, 1)).toBe(`${COUPON}_remainder_1`);
    expect(prepaidCouponIds(env)).toHaveLength(12);
    expect(new Set(prepaidCouponIds(env)).size).toBe(12);
  });

  it("mints nothing outside 1..12, and nothing at all when unconfigured", () => {
    expect(prepaidRemainderCouponId(env, 0)).toBeNull();
    expect(prepaidRemainderCouponId(env, 13)).toBeNull();
    expect(prepaidRemainderCouponId(env, 1.5)).toBeNull();
    expect(
      prepaidRemainderCouponId({ ...env, STRIPE_PREPAID_YEAR_COUPON_ID: undefined }, 9),
    ).toBeNull();
    expect(
      prepaidCouponIds({ ...env, STRIPE_PREPAID_YEAR_COUPON_ID: undefined }),
    ).toEqual([]);
  });

  it("recognises EVERY length on the item, not just the full year", () => {
    // Derived from the roster rather than a spot check, so a thirteenth length
    // added later cannot be recognised in one place and missed in another.
    for (const id of prepaidCouponIds(env)) {
      const item = {
        id: "si_licensed",
        price: { id: env.STRIPE_STARTER_PRICE_ID },
        discounts: [{ coupon: { id } }],
      } as unknown as Parameters<typeof itemHasPrepaidCoupon>[1];
      expect(itemHasPrepaidCoupon(env, item)).toBe(true);
    }
  });

  it("does not mistake the referral month for a prepaid year", () => {
    // Both are 100%-off coupons on the same licensed item. Confusing them would
    // make `prepaidCouponPending` refuse a pause for a workspace that simply
    // earned a referral, and would let a real prepaid year through as a referral.
    const item = {
      id: "si_licensed",
      price: { id: env.STRIPE_STARTER_PRICE_ID },
      discounts: [{ coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } }],
    } as unknown as Parameters<typeof itemHasPrepaidCoupon>[1];
    expect(itemHasPrepaidCoupon(env, item)).toBe(false);
  });

  it("the orphan detector sees a re-asserted year", () => {
    // The regression this whole family exists to prevent. `prepaidCouponPending`
    // is the backstop `change-plan` and `pause` use when the claim row is missing;
    // a repaired year wearing a remainder coupon must not be invisible to it.
    const withRemainder = subscriptionWith([
      { coupon: { id: `${COUPON}_remainder_7` } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]) as any;
    expect(prepaidCouponPending(env, withRemainder)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(prepaidCouponPending(env, subscriptionWith() as any)).toBe(false);
  });
});

describe("#584 counting what is left, in invoices", () => {
  /**
   * "Sized to the remaining months and never longer" is only exact if the unit is
   * the thing the coupon actually consumes: invoices. The subscription states when
   * the next one falls, and they recur monthly from there.
   */
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

  it("counts the invoices that fall inside the window", () => {
    // Next invoice 1 Sep; window closes 1 Mar. Sep, Oct, Nov, Dec, Jan, Feb — six.
    // The 1 Mar invoice is NOT inside a window that closes on 1 Mar.
    expect(
      remainingPrepaidInvoices(at("2026-09-01T00:00:00Z"), "2027-03-01T00:00:00Z"),
    ).toBe(6);
  });

  it("does not count the period already invoiced", () => {
    // That invoice went out at full price because the discount was missing, and
    // nothing here can undo it. Counting it would buy a month nobody is owed AND
    // push the coupon past `granted_through` — the one thing #584 forbids.
    expect(
      remainingPrepaidInvoices(at("2027-02-25T00:00:00Z"), "2027-03-01T00:00:00Z"),
    ).toBe(1);
  });

  it("is zero once the window closes before the next invoice", () => {
    expect(
      remainingPrepaidInvoices(at("2027-03-02T00:00:00Z"), "2027-03-01T00:00:00Z"),
    ).toBe(0);
  });

  it("never exceeds twelve, whatever the row says", () => {
    // A corrupt or hand-edited `granted_through` must not be able to mint a coupon
    // longer than a year ever was.
    expect(
      remainingPrepaidInvoices(at("2026-09-01T00:00:00Z"), "2099-01-01T00:00:00Z"),
    ).toBe(12);
  });

  it("answers zero rather than guessing when the subscription says nothing", () => {
    expect(remainingPrepaidInvoices(null, "2027-03-01T00:00:00Z")).toBe(0);
    expect(remainingPrepaidInvoices(at("2026-09-01T00:00:00Z"), "not a date")).toBe(0);
  });
});

describe("#584 ensurePrepaidDiscount", () => {
  /**
   * D107 requirement 1 promised this and it was never built: destroying paid
   * months takes one careless item write, and restoring them took a human reading
   * Stripe. The blast radius is up to $790 per workspace and it is invisible from
   * our side.
   */
  const PERIOD_END = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);

  /** A live subscription whose licensed item carries `discounts`. */
  function bare(discounts: unknown[] = [], overrides: Record<string, unknown> = {}) {
    return {
      id: "sub_1",
      status: "active",
      schedule: null,
      items: {
        data: [
          {
            id: "si_licensed",
            price: { id: env.STRIPE_STARTER_PRICE_ID },
            current_period_end: PERIOD_END,
            discounts,
          },
        ],
      },
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  const openYear = (grantedThrough = "2027-03-01T00:00:00Z") => ({
    session_id: "cs_prepay_1",
    plan: "starter",
    amount_cents: 29_000,
    currency: "usd",
    months_granted: 12,
    granted_at: "2026-03-01T00:00:00Z",
    granted_through: grantedThrough,
    discount_id: COUPON,
  });

  function convergeStripe(existingCoupons: string[] = []) {
    const updates: { id: string; params: Record<string, unknown>; options: unknown }[] =
      [];
    const created: Record<string, unknown>[] = [];
    return {
      updates,
      created,
      api: {
        coupons: {
          retrieve: vi.fn(async (id: string) => {
            if (!existingCoupons.includes(id)) throw new Error("No such coupon");
            return { id };
          }),
          create: vi.fn(async (params: Record<string, unknown>) => {
            created.push(params);
            return params;
          }),
        },
        subscriptions: {
          update: vi.fn(
            async (id: string, params: Record<string, unknown>, options: unknown) => {
              updates.push({ id, params, options });
              return bare();
            },
          ),
        },
      },
    };
  }

  const dbWith = (open: unknown) => fakeDb({ open });

  it("puts back a coupon sized to what remains, not a fresh year", async () => {
    // THE DEFECT THE CLAIM TABLE WAS INVENTED TO PREVENT. A plain re-apply restarts
    // twelve months, so a customer four months into a year they bought would end up
    // covered for sixteen — at our expense, silently.
    const stripe = convergeStripe();
    const db = dbWith(openYear());

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
    );

    expect(stripe.updates).toHaveLength(1);
    const items = stripe.updates[0].params.items as { discounts: unknown }[];
    expect(items[0].discounts).toEqual([{ coupon: `${COUPON}_remainder_6` }]);
    // And it minted the coupon it needed, because the net must not depend on
    // somebody having re-run stripe-setup.
    expect(stripe.created).toEqual([
      expect.objectContaining({
        id: `${COUPON}_remainder_6`,
        percent_off: 100,
        duration: "repeating",
        duration_in_months: 6,
      }),
    ]);
  });

  it("reuses a remainder coupon that already exists", async () => {
    const stripe = convergeStripe([`${COUPON}_remainder_6`]);
    const db = dbWith(openYear());

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
    );

    expect(stripe.created).toEqual([]);
    expect(stripe.updates).toHaveLength(1);
  });

  it("running the pass twice does not extend anything", async () => {
    // The acceptance criterion, tested the way it is written: run it twice. The
    // second pass sees the coupon it just applied and stops.
    const stripe = convergeStripe();
    const db = dbWith(openYear());

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
    );
    const applied = (stripe.updates[0].params.items as { discounts: unknown }[])[0]
      .discounts as { coupon: string }[];

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare([{ coupon: { id: applied[0].coupon } }])),
    );

    expect(stripe.updates).toHaveLength(1);
  });

  it("leaves a year that is already covered alone, at ANY length", async () => {
    const stripe = convergeStripe();
    const db = dbWith(openYear());
    for (const id of prepaidCouponIds(env)) {
      await withStripe(stripe as never, () =>
        ensurePrepaidDiscount(env, db, COMPANY_ID, bare([{ coupon: { id } }])),
      );
    }
    expect(stripe.updates).toHaveLength(0);
  });

  it("NEVER re-asserts a revoked year — refund, chargeback or conversion", async () => {
    // The most likely way to get this wrong, and the reason the gate reads the ROW.
    // All three of those paths deliberately removed the coupon seconds ago;
    // `open_prepayment` filters `revoked_at is null`, so it answers null and there
    // is nothing here to put back. A convergence keyed on "the item has no prepaid
    // discount" would hand the year straight back to a customer we just refunded.
    const stripe = convergeStripe();
    const db = dbWith(null);

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
    );

    expect(stripe.updates).toHaveLength(0);
    expect(stripe.created).toHaveLength(0);
  });

  it("leaves a window that has already run out alone", async () => {
    const stripe = convergeStripe();
    // Closes before the next invoice: nothing left to cover.
    const db = dbWith(openYear("2026-08-15T00:00:00Z"));

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
    );

    expect(stripe.updates).toHaveLength(0);
  });

  it("carries an unspent referral month through rather than deleting it", async () => {
    // The discounts array is a REPLACE. Destroying a month somebody earned would be
    // this function committing the exact class of harm it exists to repair.
    const referral = env.STRIPE_REFERRAL_MONTH_COUPON_ID as string;
    const stripe = convergeStripe();
    const db = dbWith(openYear());

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare([{ coupon: { id: referral } }])),
    );

    const items = stripe.updates[0].params.items as { discounts: unknown }[];
    expect(items[0].discounts).toEqual([
      { coupon: referral },
      { coupon: `${COUPON}_remainder_6` },
    ]);
  });

  it("stays away from a schedule-managed or non-live subscription", async () => {
    // The phases own the items while a schedule exists, and Stripe rejects item
    // writes on a dead subscription. `change-plan` already carries discounts into
    // the phases it writes.
    const stripe = convergeStripe();
    const db = dbWith(openYear());

    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare([], { schedule: "sub_sched_1" })),
    );
    await withStripe(stripe as never, () =>
      ensurePrepaidDiscount(env, db, COMPANY_ID, bare([], { status: "canceled" })),
    );

    expect(stripe.updates).toHaveLength(0);
  });

  it("never throws, because it rides a webhook", async () => {
    // A convergence miss retries on the next mirror pass. Throwing would fail the
    // event that carried it and retry work that is already correct.
    const stripe = convergeStripe();
    stripe.api.subscriptions.update = vi.fn(async () => {
      throw new Error("Stripe is down");
    });
    const db = dbWith(openYear());

    await expect(
      withStripe(stripe as never, () =>
        ensurePrepaidDiscount(env, db, COMPANY_ID, bare()),
      ),
    ).resolves.toBeUndefined();
  });
});
