/**
 * #105 (#80) paid extra numbers — the pure rules (pricing, caps, the
 * convergence formula, purchasability) and the Stripe quantity setter /
 * converger over stubbed fetch. Real product code (stripe-node, supabase-js);
 * only global fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import {
  countResponse,
  endpoint,
  makeHarness,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  convergeExtraNumberQuantity,
  desiredExtraQuantity,
  effectiveNumberAllowance,
  EXTRA_NUMBER_MONTHLY_CENTS,
  extraNumberPrice,
  extraNumberPurchasable,
  ScheduleManagedSubscriptionError,
  setExtraNumberQuantity,
  STARTER_MAX_TOTAL_NUMBERS,
} from "./extra-numbers";
import { getStripe, type Stripe } from "./stripe";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = new Date("2026-07-09T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pricing + caps (#80 decisions)", () => {
  it("prices extras at $5 Starter / $4 Pro", () => {
    expect(EXTRA_NUMBER_MONTHLY_CENTS).toEqual({ starter: 500, pro: 400 });
    expect(extraNumberPrice(env, "starter")).toBe(
      "price_extra_number_starter_0001",
    );
    expect(extraNumberPrice(env, "pro")).toBe("price_extra_number_pro_0001");
  });

  it("fails CLOSED when the price is not provisioned (never a free extra)", () => {
    const bare = { ...env, STRIPE_EXTRA_NUMBER_PRO_PRICE_ID: undefined };
    expect(extraNumberPrice(bare, "pro")).toBeNull();
  });

  it("the convergence formula: paid extras = numbers beyond the included count", () => {
    expect(desiredExtraQuantity(0, "starter")).toBe(0);
    expect(desiredExtraQuantity(1, "starter")).toBe(0); // the included one
    expect(desiredExtraQuantity(2, "starter")).toBe(1);
    expect(desiredExtraQuantity(2, "pro")).toBe(0); // both included on Pro
    expect(desiredExtraQuantity(5, "pro")).toBe(3);
  });

  it("effective allowance = included + paid extras", () => {
    expect(effectiveNumberAllowance("starter", 0)).toBe(1);
    expect(effectiveNumberAllowance("starter", 1)).toBe(2);
    expect(effectiveNumberAllowance("pro", 4)).toBe(6);
  });
});

describe("extraNumberPurchasable (#80 gates)", () => {
  const base = {
    plan: "pro" as const,
    currentCount: 2,
    country: "US",
    usTextingEnabled: true,
  };

  it("allows a US-enabled Pro company any number of extras", () => {
    expect(extraNumberPurchasable(base)).toEqual({ ok: true });
    expect(extraNumberPurchasable({ ...base, currentCount: 9 })).toEqual({
      ok: true,
    });
  });

  it("hard-caps Starter at 2 total (1 included + 1 extra)", () => {
    expect(
      extraNumberPurchasable({ ...base, plan: "starter", currentCount: 1 }),
    ).toEqual({ ok: true });
    const capped = extraNumberPurchasable({
      ...base,
      plan: "starter",
      currentCount: STARTER_MAX_TOTAL_NUMBERS,
    });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.reason).toContain("Pro");
  });

  it("refuses non-US companies and companies without US texting", () => {
    expect(extraNumberPurchasable({ ...base, country: "CA" }).ok).toBe(false);
    expect(
      extraNumberPurchasable({ ...base, usTextingEnabled: false }).ok,
    ).toBe(false);
  });
});

/** A minimal live subscription fixture carrying the given items. */
function subscription(
  items: { id: string; price: string; quantity?: number }[],
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  return {
    id: "sub_1",
    object: "subscription",
    status: "active",
    schedule: null,
    items: {
      object: "list",
      has_more: false,
      data: items.map((item) => ({
        id: item.id,
        object: "subscription_item",
        price: { id: item.price, object: "price" },
        ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
      })),
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

const PRO_PRICE = env.STRIPE_EXTRA_NUMBER_PRO_PRICE_ID as string;

describe("setExtraNumberQuantity", () => {
  it("creates the item when absent (the first paid extra), charging now", async () => {
    const harness = makeHarness([
      endpoint("POST", /\/v1\/subscription_items$/, () => ({
        id: "si_extra",
        object: "subscription_item",
      })),
    ]);
    stubFetch(harness.route);

    const result = await setExtraNumberQuantity({
      stripe: getStripe(env),
      subscription: subscription([
        { id: "si_licensed", price: env.STRIPE_PRO_PRICE_ID },
      ]),
      price: PRO_PRICE,
      quantity: 1,
      proration: "always_invoice",
      idempotencyKey: "co:extra_number_buy:key-1",
    });

    expect(result.applied).toBe(true);
    const create = harness.callsTo("POST", /\/v1\/subscription_items$/)[0];
    const form = create.form();
    expect(form.get("price")).toBe(PRO_PRICE);
    expect(form.get("quantity")).toBe("1");
    expect(form.get("proration_behavior")).toBe("always_invoice");
    expect(create.headers.get("Idempotency-Key")).toBe(
      "co:extra_number_buy:key-1",
    );
  });

  it("updates the quantity when the item exists, and no-ops when converged", async () => {
    const harness = makeHarness([
      endpoint("POST", /\/v1\/subscription_items\/si_extra/, () => ({
        id: "si_extra",
        object: "subscription_item",
      })),
    ]);
    stubFetch(harness.route);
    const sub = subscription([
      { id: "si_extra", price: PRO_PRICE, quantity: 2 },
    ]);

    const bumped = await setExtraNumberQuantity({
      stripe: getStripe(env),
      subscription: sub,
      price: PRO_PRICE,
      quantity: 3,
      proration: "always_invoice",
      idempotencyKey: "k1",
    });
    expect(bumped.applied).toBe(true);
    expect(
      harness.callsTo("POST", /\/v1\/subscription_items\/si_extra/)[0].form()
        .get("quantity"),
    ).toBe("3");

    const noop = await setExtraNumberQuantity({
      stripe: getStripe(env),
      subscription: sub,
      price: PRO_PRICE,
      quantity: 2,
      proration: "create_prorations",
      idempotencyKey: "k2",
    });
    expect(noop.applied).toBe(false);
  });

  it("deletes the item at quantity 0 (the last extra released)", async () => {
    const harness = makeHarness([
      endpoint("DELETE", /\/v1\/subscription_items\/si_extra/, () => ({
        id: "si_extra",
        deleted: true,
      })),
    ]);
    stubFetch(harness.route);

    const result = await setExtraNumberQuantity({
      stripe: getStripe(env),
      subscription: subscription([
        { id: "si_extra", price: PRO_PRICE, quantity: 1 },
      ]),
      price: PRO_PRICE,
      quantity: 0,
      proration: "create_prorations",
      idempotencyKey: "k3",
    });
    expect(result.applied).toBe(true);
    expect(
      harness.callsTo("DELETE", /\/v1\/subscription_items\/si_extra/),
    ).toHaveLength(1);
  });

  it("refuses a schedule-managed subscription (#18 — the schedule owns items)", async () => {
    stubFetch(makeHarness([]).route);
    await expect(
      setExtraNumberQuantity({
        stripe: getStripe(env),
        subscription: subscription([], { schedule: "sub_sched_1" }),
        price: PRO_PRICE,
        quantity: 1,
        proration: "always_invoice",
        idempotencyKey: "k4",
      }),
    ).rejects.toBeInstanceOf(ScheduleManagedSubscriptionError);
  });
});

describe("convergeExtraNumberQuantity (down-only; release + reconcile backstop)", () => {
  const STARTER_PRICE = env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID as string;

  function converge(options: { plan?: "starter" | "pro" } = {}) {
    return convergeExtraNumberQuantity({
      env,
      db: getDb(env),
      stripe: getStripe(env),
      companyId: COMPANY_ID,
      plan: options.plan ?? "pro",
      stripeSubscriptionId: "sub_1",
      now: NOW,
    });
  }

  const EPOCH = 7;

  /**
   * The #110 converge world: the raise-fence epoch read (companies select),
   * the FRESH subscription retrieve (converge no longer accepts a snapshot),
   * and the capacity RPC doubles — claim_extra_lower returns the given
   * verdict (its `desired` + `epoch` are authoritative); sync echoes
   * {applied:true} and records the fenced payload for assertions.
   */
  function convergeWorld(
    sub: Stripe.Subscription,
    claim?: { allowed: boolean; desired: number; count: number },
  ) {
    return [
      endpoint("GET", /\/rest\/v1\/companies/, () => [
        { paid_capacity_epoch: EPOCH },
      ]),
      endpoint("GET", /\/v1\/subscriptions\/sub_1$/, () => sub),
      ...(claim
        ? [
            endpoint("POST", /\/rest\/v1\/rpc\/claim_extra_lower/, () => ({
              ...claim,
              epoch: EPOCH + 1,
            })),
          ]
        : []),
      endpoint(
        "POST",
        /\/rest\/v1\/rpc\/sync_paid_extra_capacity/,
        (call) => ({
          applied: true,
          capacity: (call.json() as { p_billed: number }).p_billed,
          epoch: (call.json() as { p_expected_epoch: number }).p_expected_epoch,
        }),
      ),
    ];
  }

  it("credits a crashed release back down to the formula (item-scoped key)", async () => {
    // Pro, 3 numbers → desired 1 extra, but the item still says 2.
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(3)),
      ...convergeWorld(
        subscription([{ id: "si_extra", price: PRO_PRICE, quantity: 2 }]),
        { allowed: true, desired: 1, count: 3 },
      ),
      endpoint("POST", /\/v1\/subscription_items\/si_extra/, () => ({
        id: "si_extra",
      })),
    ]);
    stubFetch(harness.route);

    const result = await converge();

    expect(result).toEqual({ kind: "lowered", quantity: 1 });
    const update = harness.callsTo(
      "POST",
      /\/v1\/subscription_items\/si_extra/,
    )[0];
    expect(update.form().get("quantity")).toBe("1");
    // Convergence credit rides the next invoice; the key carries the ITEM id
    // so a same-day transition against a different item never replays this one.
    expect(update.form().get("proration_behavior")).toBe("create_prorations");
    expect(update.headers.get("Idempotency-Key")).toBe(
      `${COMPANY_ID}:extra_number_converge:si_extra:1:2026-07-09`,
    );
  });

  it("NEVER charges upward: an over-included count is reported, not billed", async () => {
    // The D16 port-bridge shape: a Starter mid-port legitimately holds 2
    // non-released rows with NOTHING bought — billing it would be an
    // unconsented charge. The formula says 1; the item says 0; converge must
    // only report.
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(2)),
      ...convergeWorld(subscription([])),
    ]);
    stubFetch(harness.route);

    const result = await converge({ plan: "starter" });
    expect(result).toEqual({
      kind: "over_included_unbilled",
      billed: 0,
      desired: 1,
    });
    // No Stripe WRITE of any kind (the one GET is the fresh retrieve).
    expect(
      harness.calls.filter(
        (call) =>
          call.url.host === "api.stripe.com" && call.method !== "GET",
      ),
    ).toHaveLength(0);
  });

  it("migrates a wrong-plan item stranded by an upgrade (never bills forever)", async () => {
    // Upgraded starter→pro with a surviving $5 Starter item, 3 numbers
    // (desired 1 on Pro): the item moves to the Pro price at quantity 1.
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(3)),
      ...convergeWorld(
        subscription([{ id: "si_stale", price: STARTER_PRICE, quantity: 1 }]),
        { allowed: true, desired: 1, count: 3 },
      ),
      endpoint("POST", /\/v1\/subscription_items\/si_stale/, () => ({
        id: "si_stale",
      })),
    ]);
    stubFetch(harness.route);

    const result = await converge();
    expect(result).toEqual({ kind: "migrated", quantity: 1 });
    const update = harness.callsTo(
      "POST",
      /\/v1\/subscription_items\/si_stale/,
    )[0];
    expect(update.form().get("price")).toBe(PRO_PRICE);
    expect(update.form().get("quantity")).toBe("1");
  });

  it("deletes a wrong-plan item when the formula supports no extras", async () => {
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(2)),
      ...convergeWorld(
        subscription([{ id: "si_stale", price: STARTER_PRICE, quantity: 1 }]),
        { allowed: true, desired: 0, count: 2 },
      ),
      endpoint("DELETE", /\/v1\/subscription_items\/si_stale/, () => ({
        id: "si_stale",
        deleted: true,
      })),
    ]);
    stubFetch(harness.route);

    const result = await converge();
    expect(result).toEqual({ kind: "migrated", quantity: 0 });
    expect(
      harness.callsTo("DELETE", /\/v1\/subscription_items\/si_stale/),
    ).toHaveLength(1);
  });

  it("already converged → noop without touching Stripe; capacity self-heals to billed", async () => {
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(3)),
      ...convergeWorld(
        subscription([{ id: "si_extra", price: PRO_PRICE, quantity: 1 }]),
      ),
    ]);
    stubFetch(harness.route);

    const result = await converge();
    expect(result).toEqual({ kind: "noop", quantity: 1 });
    // #110 backfill/self-heal: the capacity column mirrors the billed truth,
    // and the RAISE is fenced with the epoch read BEFORE the snapshot.
    const sync = harness.callsTo(
      "POST",
      /\/rest\/v1\/rpc\/sync_paid_extra_capacity/,
    )[0];
    expect(sync.json()).toMatchObject({ p_billed: 1, p_expected_epoch: EPOCH });
    // No Stripe WRITE of any kind (the one GET is the fresh retrieve).
    expect(
      harness.calls.filter(
        (call) =>
          call.url.host === "api.stripe.com" && call.method !== "GET",
      ),
    ).toHaveLength(0);
  });

  it("#110: a raced admit consumes the credit — the claim's re-count wins, no Stripe write", async () => {
    // Our pre-lock count said 3 (desired 1, billed 2 → lower), but a port was
    // admitted between that count and the claim: the claim re-counts UNDER the
    // company lock and reports desired 2 == billed → the credit is off.
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(3)),
      ...convergeWorld(
        subscription([{ id: "si_extra", price: PRO_PRICE, quantity: 2 }]),
        { allowed: false, desired: 2, count: 4 },
      ),
    ]);
    stubFetch(harness.route);

    const result = await converge();
    expect(result).toEqual({ kind: "noop", quantity: 2 });
    expect(
      harness.calls.filter(
        (call) =>
          call.url.host === "api.stripe.com" && call.method !== "GET",
      ),
    ).toHaveLength(0);
  });

  it("schedule-managed: writes NO quantities but mirrors billed capacity, then skips", async () => {
    const harness = makeHarness([
      ...convergeWorld(
        subscription([{ id: "si_extra", price: PRO_PRICE, quantity: 2 }], {
          schedule: "sub_sched_1",
        }),
      ),
    ]);
    stubFetch(harness.route);
    const result = await converge();
    expect(result).toBeNull();
    // #18: the schedule owns the items — no Stripe writes…
    expect(
      harness.calls.filter(
        (call) =>
          call.url.host === "api.stripe.com" && call.method !== "GET",
      ),
    ).toHaveLength(0);
    // …but the capacity column keeps mirroring what is actually billed, so a
    // pending downgrade can't leave stale-high capacity for a whole period.
    const sync = harness.callsTo(
      "POST",
      /\/rest\/v1\/rpc\/sync_paid_extra_capacity/,
    )[0];
    expect(sync.json()).toMatchObject({ p_billed: 2, p_expected_epoch: EPOCH });
  });

  it("#110: the crashed-run retry (column already lowered, Stripe still high) STILL writes Stripe", async () => {
    // A prior run claimed (column→desired) then died before the Stripe write.
    // This run: claim reports allowed:false desired=1 — but billed=2 > 1, so
    // the credit MUST still land (allowed:false only means no shrink needed).
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(3)),
      ...convergeWorld(
        subscription([{ id: "si_extra", price: PRO_PRICE, quantity: 2 }]),
        { allowed: false, desired: 1, count: 3 },
      ),
      endpoint("POST", /\/v1\/subscription_items\/si_extra/, () => ({
        id: "si_extra",
      })),
    ]);
    stubFetch(harness.route);

    const result = await converge();
    expect(result).toEqual({ kind: "lowered", quantity: 1 });
    const update = harness.callsTo(
      "POST",
      /\/v1\/subscription_items\/si_extra/,
    )[0];
    expect(update.form().get("quantity")).toBe("1");
  });

  it("no-ops when the price was never provisioned (fail closed, no read)", async () => {
    stubFetch(makeHarness([]).route);
    const bare = { ...env, STRIPE_EXTRA_NUMBER_PRO_PRICE_ID: undefined };
    const result = await convergeExtraNumberQuantity({
      env: bare,
      db: getDb(bare),
      stripe: getStripe(bare),
      companyId: COMPANY_ID,
      plan: "pro",
      stripeSubscriptionId: "sub_1",
      now: NOW,
    });
    expect(result).toBeNull();
  });
});
