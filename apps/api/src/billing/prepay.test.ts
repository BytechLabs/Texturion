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
  prepayEligibility,
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
