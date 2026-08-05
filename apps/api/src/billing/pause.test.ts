/**
 * #277 — the seasonal pause.
 *
 * Every assertion here is against a failure that is INVISIBLE on the happy
 * path, which is what makes this mechanism dangerous rather than merely fiddly:
 *
 *  1. A paused workspace is genuinely `active` in Stripe with its `plan`
 *     intact, so every existing eligibility test in this product passes for it.
 *     Three separate features would have done the wrong thing quietly.
 *  2. Unsetting the price env var would, under the obvious two-state reading of
 *     the subscription, silently un-pause every paused workspace into full
 *     service on a holding fee — on a cron, with nothing failing.
 */
import { describe, expect, it, vi } from "vitest";

import { completeEnv } from "../test/support";
import {
  isPauseLicensedPrice,
  pauseLicensedPrice,
  planForLicensedPrice,
} from "./plans";
import {
  pauseEligibility,
  pausePriceSnapshot,
  pausedLicensedItem,
  planLicensedItem,
  referralMonthPending,
  type CompanyForPause,
} from "./pause";
import {
  PREPAY_METADATA_FIELD,
  PREPAY_METADATA_KIND,
  PREPAY_PLAN_FIELD,
  grantPrepaidYear,
  prepayEligibility,
} from "./prepay";

const env = completeEnv();
const COMPANY_ID = "9b2c4d6e-8f0a-4b3c-9d5e-7f1a3b5c7d9e";

function company(overrides: Partial<CompanyForPause> = {}): CompanyForPause {
  return {
    id: COMPANY_ID,
    plan: "starter",
    subscription_status: "active",
    stripe_subscription_id: "sub_1",
    paused_at: null,
    paused_price_cents: null,
    ...overrides,
  };
}

/** A Supabase stand-in that answers only `open_prepayment`. */
function fakeDb(open: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data: open, error: null })),
  } as never;
}

function subscription(priceIds: string[], extra: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    items: {
      data: priceIds.map((id, index) => ({
        id: `si_${index}`,
        price: { id, unit_amount: 500 },
        discounts: (extra.discounts as unknown[]) ?? [],
      })),
    },
    ...extra,
  } as never;
}

/** A Stripe stand-in that answers `prices.retrieve` with one fixed price. */
function priceStub(price: Record<string, unknown>) {
  return {
    prices: { retrieve: vi.fn(async () => price) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const LIVE_PAUSE_PRICE = {
  id: "price_pause_0001",
  active: true,
  unit_amount: 500,
  recurring: { interval: "month", interval_count: 1 },
};

describe("the price id is the feature flag, and it fails CLOSED (#277)", () => {
  it("reports not_provisioned rather than pausing for free", async () => {
    // The failure this prevents is not an error — it is a workspace holding a
    // number and a live 10DLC campaign, which cost us ~$3/mo between them,
    // against no revenue at all, because somebody deployed before provisioning.
    const bare = { ...env, STRIPE_PAUSE_PRICE_ID: undefined };
    await expect(pauseEligibility(bare, fakeDb(), company())).resolves.toEqual({
      eligible: false,
      reason: "not_provisioned",
    });
  });

  it("treats an empty string as unprovisioned", () => {
    // A Cloudflare variable created and then blanked reads as "". A bare
    // truthiness check would pass it through and 400 at Stripe, halfway through
    // a swap, with the customer already told the pause worked.
    expect(pauseLicensedPrice({ ...env, STRIPE_PAUSE_PRICE_ID: "" })).toBeNull();
    expect(pauseLicensedPrice(env)).toBe("price_pause_0001");
  });

  it("never resolves the pause price to a plan, which is what protects the spending cap", () => {
    // A third plan_id would give the quota CASE in the messaging functions no
    // arm, making v_cap NULL and the overage ceiling permanently open. The
    // pause price staying foreign to planForLicensedPrice is what keeps
    // `companies.plan` — and therefore that cap — untouched.
    expect(planForLicensedPrice(env, "price_pause_0001")).toBeNull();
    expect(isPauseLicensedPrice(env, "price_pause_0001")).toBe(true);
    expect(isPauseLicensedPrice(env, env.STRIPE_STARTER_PRICE_ID)).toBe(false);
  });

  it("recognises no price as a pause when unprovisioned", () => {
    const bare = { ...env, STRIPE_PAUSE_PRICE_ID: undefined };
    expect(isPauseLicensedPrice(bare, "price_pause_0001")).toBe(false);
  });
});

describe("pauseEligibility (#277)", () => {
  it("admits a healthy active workspace", async () => {
    await expect(
      pauseEligibility(env, fakeDb(), company(), subscription([env.STRIPE_STARTER_PRICE_ID])),
    ).resolves.toEqual({ eligible: true, open: null });
  });

  it("refuses a workspace that is already paused", async () => {
    await expect(
      pauseEligibility(env, fakeDb(), company({ paused_at: "2026-11-04T00:00:00Z" })),
    ).resolves.toMatchObject({ eligible: false, reason: "already_paused" });
  });

  it("refuses an unhealthy subscription — swapping price collects nothing owed", async () => {
    await expect(
      pauseEligibility(env, fakeDb(), company({ subscription_status: "past_due" })),
    ).resolves.toMatchObject({ eligible: false, reason: "subscription_unhealthy" });
    await expect(
      pauseEligibility(env, fakeDb(), company({ subscription_status: "canceled" })),
    ).resolves.toMatchObject({ eligible: false, reason: "subscription_unhealthy" });
  });

  it("refuses a schedule-managed subscription rather than failing at Stripe", async () => {
    // Stripe rejects item writes while a schedule owns the items, so without
    // this the swap fails AFTER the customer has been told it worked.
    await expect(
      pauseEligibility(
        env,
        fakeDb(),
        company(),
        subscription([env.STRIPE_STARTER_PRICE_ID], { schedule: "sub_sched_1" }),
      ),
    ).resolves.toMatchObject({ eligible: false, reason: "plan_change_pending" });
  });

  it("refuses a workspace with an open prepaid year — this one is money", async () => {
    // The prepaid year is a 100%-off coupon riding the LICENSED item. Swapping
    // that item's price moves the coupon onto the pause fee, so the customer
    // would pause for free while burning months they already paid for.
    const open = {
      session_id: "cs_1",
      plan: "starter",
      amount_cents: 29_000,
      months_granted: 12,
      granted_at: "2026-01-01T00:00:00Z",
      granted_through: "2027-01-01T00:00:00Z",
      discount_id: "di_1",
    };
    await expect(
      pauseEligibility(env, fakeDb(open), company(), subscription([env.STRIPE_STARTER_PRICE_ID])),
    ).resolves.toMatchObject({ eligible: false, reason: "already_prepaid" });
  });

  it("refuses a workspace with no subscription to hold", async () => {
    await expect(
      pauseEligibility(env, fakeDb(), company({ plan: null })),
    ).resolves.toMatchObject({ eligible: false, reason: "no_subscription" });
  });

  it("refuses an UNSPENT REFERRAL MONTH — the free pause the prepaid-year gate missed", async () => {
    // #399's free month is a 100%-off coupon on the same LICENSED item a pause
    // swaps. Earn one, pause before the next invoice, and the pause bills $0
    // while we pay ~$3/mo for the held number and the live campaign — and the
    // customer burns a $29/$79 credit on a ~$5 charge. `already_prepaid` was
    // refused for exactly this reason and this coupon was not.
    const withMonth = subscription([env.STRIPE_STARTER_PRICE_ID], {
      discounts: [{ id: "di_1", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } }],
    });
    await expect(
      pauseEligibility(env, fakeDb(), company(), withMonth),
    ).resolves.toMatchObject({ eligible: false, reason: "referral_month_pending" });
  });

  it("admits a workspace whose referral month has already been spent", async () => {
    // The coupon is `duration: once`, so Stripe DROPS it from the item the
    // moment it lands on an invoice. "Still carries the coupon" is therefore the
    // same question as "not spent yet" — and a workspace that already had its
    // free month must not be locked out of pausing forever.
    await expect(
      pauseEligibility(env, fakeDb(), company(), subscription([env.STRIPE_STARTER_PRICE_ID])),
    ).resolves.toEqual({ eligible: true, open: null });
  });

  it("does not mistake the PREPAID-YEAR coupon for a referral month", () => {
    const yearly = subscription([env.STRIPE_STARTER_PRICE_ID], {
      discounts: [{ id: "di_1", coupon: { id: env.STRIPE_PREPAID_YEAR_COUPON_ID } }],
    });
    expect(referralMonthPending(env, yearly)).toBe(false);
  });

  it("cannot recognise a referral month with no coupon provisioned", () => {
    // Nothing pays out in that state either, so there is no unspent month to
    // protect — and refusing every pause on a guess would be the worse error.
    const withMonth = subscription([env.STRIPE_STARTER_PRICE_ID], {
      discounts: [{ id: "di_1", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } }],
    });
    expect(
      referralMonthPending({ ...env, STRIPE_REFERRAL_MONTH_COUPON_ID: undefined }, withMonth),
    ).toBe(false);
  });
});

describe("the pause price has to be able to BILL (#277)", () => {
  it("reads the live catalog amount for a healthy price", async () => {
    await expect(pausePriceSnapshot(env, priceStub(LIVE_PAUSE_PRICE))).resolves.toEqual({
      id: "price_pause_0001",
      cents: 500,
    });
  });

  it("refuses a $0 price — the free pause every other guard passes", async () => {
    // The env var is set, the id resolves, the swap would succeed and the
    // subscription would stay active. Nothing else in this feature can tell the
    // difference between that and a real pause, and the workspace holds a number
    // and a live 10DLC campaign — ~$3/mo of ours — against no revenue at all.
    await expect(
      pausePriceSnapshot(env, priceStub({ ...LIVE_PAUSE_PRICE, unit_amount: 0 })),
    ).resolves.toBeNull();
  });

  it("refuses a TIERED price, which would re-value the tenant at full plan price", async () => {
    // A tiered price has no `unit_amount`, so `paused_price_cents` mirrors NULL
    // and the #85 projection falls back to the plan's list price — the founder's
    // underwater report then renders the paused cohort as the most profitable
    // customers in the product. That column exists to prevent exactly that.
    await expect(
      pausePriceSnapshot(env, priceStub({ ...LIVE_PAUSE_PRICE, unit_amount: null })),
    ).resolves.toBeNull();
  });

  it("refuses an archived price and a non-monthly one", async () => {
    // Archived: Stripe refuses to put it on a subscription, so the swap would
    // 400 halfway through. Yearly: the figure beside the word "month" would be
    // off by twelve.
    await expect(
      pausePriceSnapshot(env, priceStub({ ...LIVE_PAUSE_PRICE, active: false })),
    ).resolves.toBeNull();
    await expect(
      pausePriceSnapshot(
        env,
        priceStub({ ...LIVE_PAUSE_PRICE, recurring: { interval: "year", interval_count: 1 } }),
      ),
    ).resolves.toBeNull();
    await expect(
      pausePriceSnapshot(
        env,
        priceStub({ ...LIVE_PAUSE_PRICE, recurring: { interval: "month", interval_count: 3 } }),
      ),
    ).resolves.toBeNull();
  });

  it("asks Stripe nothing at all when the price is unprovisioned", async () => {
    const stripe = priceStub(LIVE_PAUSE_PRICE);
    await expect(
      pausePriceSnapshot({ ...env, STRIPE_PAUSE_PRICE_ID: undefined }, stripe),
    ).resolves.toBeNull();
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
  });
});

describe("the item a swap actually touches (#277)", () => {
  it("finds the PLAN licensed item and never a module or extra-number line", () => {
    // Both of those are unmetered too, so "the first item without a meter"
    // would leave the workspace on its full plan while quietly converting its
    // Calling add-on into a pause.
    const sub = subscription([
      env.STRIPE_MODULE_VOICE_PRICE_ID as string,
      env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID as string,
      env.STRIPE_STARTER_PRICE_ID,
    ]);
    expect(planLicensedItem(env, sub)?.price.id).toBe(env.STRIPE_STARTER_PRICE_ID);
  });

  it("finds the PAUSE item on the way back, and nothing when unprovisioned", () => {
    const sub = subscription(["price_pause_0001", env.STRIPE_STARTER_OVERAGE_PRICE_ID]);
    expect(pausedLicensedItem(env, sub)?.price.id).toBe("price_pause_0001");
    expect(
      pausedLicensedItem({ ...env, STRIPE_PAUSE_PRICE_ID: undefined }, sub),
    ).toBeUndefined();
  });

  it("finds no plan item on a paused subscription — the case change-plan must not 500 on", () => {
    const sub = subscription(["price_pause_0001", env.STRIPE_STARTER_OVERAGE_PRICE_ID]);
    expect(planLicensedItem(env, sub)).toBeUndefined();
  });
});

/**
 * The prepay race: a Checkout Session outlives the check that gated it.
 *
 * `prepayEligibility` refuses a paused workspace, but it runs when the session
 * is CREATED. The session stays payable for ~24h and an unpaid prepayment has no
 * row anywhere — `open_prepayment` requires `granted_at` — so `pauseEligibility`
 * cannot see one coming. Open the page, pause, pay on the tab that is still
 * sitting there, and both gates have already passed.
 */
describe("a prepaid year that is paid AFTER the pause is still honoured (#277)", () => {
  const COUPON = env.STRIPE_PREPAID_YEAR_COUPON_ID as string;

  function prepaySession() {
    return {
      id: "cs_prepay_race",
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
    } as never;
  }

  /** Records every `companies` write, so a missing mirror clear is visible. */
  function grantDb() {
    const writes: Record<string, unknown>[] = [];
    return {
      writes,
      db: {
        rpc: vi.fn(async (fn: string) => {
          if (fn === "claim_prepayment") {
            return { data: { outcome: "claimed" }, error: null };
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
          update: (values: Record<string, unknown>) => ({
            eq: async () => {
              writes.push(values);
              return { error: null };
            },
          }),
        }),
      } as never,
    };
  }

  function grantStripe(sub: unknown) {
    const updates: { id: string; params: Record<string, unknown> }[] = [];
    return {
      updates,
      api: {
        subscriptions: {
          retrieve: vi.fn(async () => sub),
          update: vi.fn(async (id: string, params: Record<string, unknown>) => {
            updates.push({ id, params });
            return sub;
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };
  }

  async function withStripe<T>(
    stub: ReturnType<typeof grantStripe>,
    run: () => Promise<T>,
  ) {
    const mod = await import("./stripe");
    const spy = vi.spyOn(mod, "getStripe").mockReturnValue(stub.api);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it("lifts the pause and applies the coupon in ONE item write", async () => {
    // The old behaviour was a throw, and it was a permanent loss rather than a
    // retryable error: `claim_prepayment` has already COMMITTED, so every
    // webhook retry re-enters at `resume` and throws again until the sweeper
    // abandons the row after five attempts. $790 collected, prepayment row
    // written, no coupon, nobody told.
    const stub = grantStripe(
      subscription(["price_pause_0001", env.STRIPE_STARTER_OVERAGE_PRICE_ID]),
    );
    const { db, writes } = grantDb();
    const result = await withStripe(stub, () => grantPrepaidYear(env, db, prepaySession()));

    expect(result.outcome).toBe("granted");
    expect(stub.updates).toHaveLength(1);
    const items = stub.updates[0].params.items as {
      id: string;
      price?: string;
      discounts: unknown;
    }[];
    // The SAME item write: the pause price becomes the plan price and the year's
    // coupon lands on it. Two writes would leave a window in which a
    // twelve-month 100%-off coupon is sitting on a ~$5 holding fee.
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("si_0");
    expect(items[0].price).toBe(env.STRIPE_STARTER_PRICE_ID);
    expect(items[0].discounts).toEqual([{ coupon: COUPON }]);
    // No proration: they have just paid twelve months up front and owe nothing
    // more for this period.
    expect(stub.updates[0].params.proration_behavior).toBe("none");

    // And the mirror, or five SQL send gates keep refusing a customer who has
    // just paid for a year — with no self-serve way out, because the
    // subscription no longer carries a pause item for /resume to swap back.
    expect(writes).toEqual([{ paused_at: null, paused_price_cents: null }]);
  });

  it("leaves an unpaused subscription completely alone", async () => {
    // The resume path must fire only for a pause. A price key on an ordinary
    // grant would re-write the licensed line of every prepaying customer.
    const stub = grantStripe(
      subscription([env.STRIPE_STARTER_PRICE_ID, env.STRIPE_STARTER_OVERAGE_PRICE_ID]),
    );
    const { db, writes } = grantDb();
    await withStripe(stub, () => grantPrepaidYear(env, db, prepaySession()));

    const items = stub.updates[0].params.items as { price?: string }[];
    expect(items[0].price).toBeUndefined();
    expect(stub.updates[0].params.proration_behavior).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it("resumes a paused item that ALREADY carries the year's coupon", async () => {
    // The `|| resumePrice !== null` term in the grant, which had nothing
    // asserting it. Reachable because `stamp_prepayment` is deliberately
    // non-fatal: a grant whose Stripe write landed but whose stamp did not
    // leaves `granted_at` null, so `open_prepayment` sees nothing, so
    // `pauseEligibility` allows a pause — and a price swap KEEPS the item's
    // discounts, which puts a twelve-month 100%-off coupon on the ~$5 holding
    // fee. The sweeper then re-enters here at outcome `resume`.
    //
    // Without the term, `itemHasDiscount` is true and the write is skipped: the
    // free pause stands, `clearPauseMirror` never runs, and the customer stays
    // blocked from sending on a year they have paid for.
    const stub = grantStripe(
      subscription(["price_pause_0001", env.STRIPE_STARTER_OVERAGE_PRICE_ID], {
        discounts: [{ id: "di_1", coupon: { id: COUPON } }],
      }),
    );
    const { db, writes } = grantDb();
    await withStripe(stub, () => grantPrepaidYear(env, db, prepaySession()));

    expect(stub.updates).toHaveLength(1);
    const items = stub.updates[0].params.items as { id: string; price?: string }[];
    expect(items[0].id).toBe("si_0");
    expect(items[0].price).toBe(env.STRIPE_STARTER_PRICE_ID);
    expect(writes).toEqual([{ paused_at: null, paused_price_cents: null }]);
  });

  it("still refuses rather than guessing when the pause price is unset", async () => {
    // Without STRIPE_PAUSE_PRICE_ID we cannot tell WHICH item the pause is
    // sitting on, and "the unmetered one" would convert somebody's Calling
    // add-on into their plan. The throw names the shape so the alert is
    // actionable.
    const bare = { ...env, STRIPE_PAUSE_PRICE_ID: undefined };
    const stub = grantStripe(
      subscription(["price_pause_0001", env.STRIPE_STARTER_OVERAGE_PRICE_ID]),
    );
    const { db } = grantDb();
    await expect(
      withStripe(stub, () => grantPrepaidYear(bare, db, prepaySession())),
    ).rejects.toThrow(/pause price is unset/);
    expect(stub.updates).toHaveLength(0);
  });
});

describe("a coupon with no row behind it still blocks a pause (#277/#400)", () => {
  it("refuses a prepaid-year coupon the prepayments row does not know about", async () => {
    // `stamp_prepayment` is deliberately non-fatal — throwing there would let
    // the sweeper re-apply the coupon and RESTART its twelve months. So a lost
    // stamp leaves `granted_at` null, `open_prepayment` answers nothing, and the
    // `already_prepaid` gate waves the pause through. The swap then carries the
    // item's discounts onto the pause price: twelve months of a free hold, on a
    // customer who has also just lost the year they paid for.
    const withYear = subscription(
      [env.STRIPE_STARTER_PRICE_ID, env.STRIPE_STARTER_OVERAGE_PRICE_ID],
      { discounts: [{ id: "di_1", coupon: { id: env.STRIPE_PREPAID_YEAR_COUPON_ID } }] },
    );
    await expect(
      pauseEligibility(env, fakeDb(null), company(), withYear),
    ).resolves.toMatchObject({ eligible: false, reason: "prepaid_coupon_orphaned" });
  });

  it("says nothing about a subscription carrying no such coupon", async () => {
    await expect(
      pauseEligibility(
        env,
        fakeDb(null),
        company(),
        subscription([env.STRIPE_STARTER_PRICE_ID, env.STRIPE_STARTER_OVERAGE_PRICE_ID]),
      ),
    ).resolves.toMatchObject({ eligible: true });
  });
});

describe("a pause refuses a prepaid year BEFORE the money moves (#277)", () => {
  it("is ineligible for a prepaid year while paused", async () => {
    // Every other test in prepayEligibility passes for a paused workspace:
    // `plan` is still populated and the status is still 'active'. Without this
    // gate the grant would go looking for a licensed item at a plan price that
    // is no longer on the subscription and throw — AFTER claim_prepayment had
    // committed and AFTER Stripe had taken the money.
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              not: () => ({ limit: async () => ({ data: [{ id: "m1" }], error: null }) }),
            }),
          }),
        }),
      }),
    } as never;
    await expect(
      prepayEligibility(env, db, {
        id: COMPANY_ID,
        plan: "starter",
        subscription_status: "active",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        paused_at: "2026-11-04T00:00:00Z",
      }),
    ).resolves.toMatchObject({ eligible: false, reason: "workspace_paused" });
  });
});
