/**
 * #523 — the held-number surface: what a workspace is holding that its plan does
 * not cover, and the paid way back.
 *
 * The hold itself is decided in Postgres (`claim_number_allowance`, proved in
 * supabase/tests/number_allowance.test.sql against a real database). What is
 * pinned here is the layer this file owns: what the read tells a client, and the
 * order the reinstate route does things in — every refusal before any money
 * moves, the charge before the un-hold, and never a second charge for a number
 * that is already back.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { billingRoutes } from "./billing";
import { PLAN_LIMITS, type PlanId } from "../billing/plans";
import type { AppEnv, MemberRole } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import {
  endpoint,
  makeHarness,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const NUMBER_ID = "b1f1f6a1-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const IDEMPOTENCY_KEY = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";

function makeApp(role: MemberRole): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", USER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("memberId", MEMBER_ID);
    c.set("role", role);
    await next();
  });
  app.route("/v1/billing", billingRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    throw error;
  });
  return app;
}

async function get(
  path: string,
  harness: Harness,
  role: MemberRole = "owner",
): Promise<Response> {
  stubFetch(harness.route);
  return makeApp(role).request(path, { method: "GET" }, env);
}

async function reinstate(
  harness: Harness,
  options: { key?: string | null; role?: MemberRole; id?: string } = {},
): Promise<Response> {
  stubFetch(harness.route);
  const key = options.key === undefined ? IDEMPOTENCY_KEY : options.key;
  return makeApp(options.role ?? "owner").request(
    `/v1/billing/held-numbers/${options.id ?? NUMBER_ID}/reinstate`,
    {
      method: "POST",
      headers: key === null ? {} : { "Idempotency-Key": key },
    },
    env,
  );
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    plan: "starter",
    country: "US",
    us_texting_enabled: true,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    registration_fee_paid_at: null,
    billing_currency: "usd",
    paused_at: null,
    paused_price_cents: null,
    paid_extra_numbers: 0,
    paid_capacity_epoch: 4,
    ...overrides,
  };
}

function companyEndpoint(row: Record<string, unknown>): StubEndpoint {
  return endpoint("GET", /\/rest\/v1\/companies/, () => [row]);
}

function heldRows(rows: unknown[]): StubEndpoint {
  return endpoint("GET", /\/rest\/v1\/phone_numbers/, () => rows);
}

const HELD = {
  id: NUMBER_ID,
  number_e164: "+14155550102",
  suspended_at: "2026-07-30T00:00:00.000Z",
};

/**
 * The claim (`claim_number_allowance`). The default is the deliverable
 * purchase: one unit of capacity bought, and THE named number back. Tests that
 * want a refusal or a mis-delivery override the fields they care about.
 */
function claimRpc(result: Record<string, unknown> = {}): StubEndpoint {
  return endpoint("POST", /\/rest\/v1\/rpc\/claim_number_allowance/, () => ({
    applied: true,
    plan_known: true,
    allowance: 2,
    capacity: 1,
    capacity_fenced: false,
    restored: [{ id: NUMBER_ID, number_e164: "+14155550102" }],
    held: [],
    ...result,
  }));
}

function subscriptionFixture(
  overrides: {
    schedule?: string | null;
    extraQuantity?: number | null;
    plan?: PlanId;
  } = {},
) {
  const { schedule = null, extraQuantity = null, plan = "starter" } = overrides;
  return {
    id: "sub_1",
    object: "subscription",
    status: "active",
    schedule,
    items: {
      object: "list",
      data: [
        {
          id: "si_licensed",
          object: "subscription_item",
          quantity: 1,
          price: {
            id:
              plan === "pro"
                ? env.STRIPE_PRO_PRICE_ID
                : env.STRIPE_STARTER_PRICE_ID,
            object: "price",
            recurring: { interval: "month" },
          },
        },
        ...(extraQuantity === null
          ? []
          : [
              {
                id: "si_extra",
                object: "subscription_item",
                quantity: extraQuantity,
                price: {
                  id:
                    plan === "pro"
                      ? env.STRIPE_EXTRA_NUMBER_PRO_PRICE_ID
                      : env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID,
                  object: "price",
                  recurring: { interval: "month" },
                },
              },
            ]),
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /v1/billing/held-numbers (#523)", () => {
  it("names what is held, what the plan covers, and what un-holding one costs", async () => {
    const harness = makeHarness([companyEndpoint(companyRow()), heldRows([HELD])]);
    const response = await get("/v1/billing/held-numbers", harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plan: "starter",
      included: 1,
      paid_extras: 0,
      allowance: 1,
      // 1 included + 1 sellable extra (#80's hard Starter cap).
      max_total: 2,
      reason: "over_plan_allowance",
      held: [HELD],
      // From the price book, WITH its currency — a bare "$5" on a workspace
      // billed in CAD is #522 happening again.
      extra_number_cents: 500,
      extra_number_currency: "usd",
      can_reinstate: true,
      can_upgrade: true,
    });
  });

  it("a CANCELLED workspace's suspended numbers are the grace window, not a plan hold", async () => {
    // The same row state means two different things, and the difference decides
    // which card the billing screen shows. Answered here rather than left for
    // three clients to infer from two fields.
    const harness = makeHarness([
      companyEndpoint(companyRow({ subscription_status: "canceled" })),
      heldRows([HELD]),
    ]);
    const body = (await (await get("/v1/billing/held-numbers", harness)).json()) as {
      reason: string;
      can_reinstate: boolean;
    };
    expect(body.reason).toBe("subscription_inactive");
    expect(body.can_reinstate).toBe(false);
  });

  it("holds nothing: null reason, and no offer to buy anything", async () => {
    const harness = makeHarness([companyEndpoint(companyRow()), heldRows([])]);
    const body = (await (await get("/v1/billing/held-numbers", harness)).json()) as {
      reason: string | null;
      held: unknown[];
      can_reinstate: boolean;
    };
    expect(body.reason).toBeNull();
    expect(body.held).toEqual([]);
    expect(body.can_reinstate).toBe(false);
  });

  it("Starter already at its hard cap cannot buy more capacity — only Pro", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ paid_extra_numbers: 1 })),
      heldRows([HELD]),
    ]);
    const body = (await (await get("/v1/billing/held-numbers", harness)).json()) as {
      can_reinstate: boolean;
      can_upgrade: boolean;
      allowance: number;
    };
    expect(body.allowance).toBe(2);
    expect(body.can_reinstate).toBe(false);
    expect(body.can_upgrade).toBe(true);
  });

  it("a paused workspace is sold nothing (#277)", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ paused_at: "2026-11-04T00:00:00.000Z" })),
      heldRows([HELD]),
    ]);
    const body = (await (await get("/v1/billing/held-numbers", harness)).json()) as {
      can_reinstate: boolean;
    };
    expect(body.can_reinstate).toBe(false);
  });

  it("403 for a member — this whole router is billing.manage (#315)", async () => {
    const harness = makeHarness([]);
    const response = await get("/v1/billing/held-numbers", harness, "member");
    expect(response.status).toBe(403);
    expect(harness.calls).toHaveLength(0);
  });
});

describe("POST /v1/billing/held-numbers/:id/reinstate (#523)", () => {
  it("brings the number back FIRST, then charges for the capacity it just granted", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
        id: "si_extra",
        object: "subscription_item",
        quantity: 1,
      })),
      claimRpc(),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => new Response(null, { status: 201 })),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reinstated: true,
      paid_extras: 1,
      allowance: 2,
      held: [],
    });

    // THE ORDER. The claim is the authority on whether the number can come
    // back, so it runs first and the charge follows what it actually did.
    // Charge-first is what let a fenced claim take the money and leave the
    // number held.
    const claimIndex = harness.calls.findIndex((call) =>
      /rpc\/claim_number_allowance/.test(call.url.href),
    );
    const chargeIndex = harness.calls.findIndex((call) =>
      /subscription_items$/.test(call.url.href),
    );
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(chargeIndex).toBeGreaterThan(claimIndex);

    // The charge lands NOW, at the extra-number price, for exactly one more
    // unit — never the whole surplus, and never on the next invoice as a
    // surprise.
    const items = harness.callsTo("POST", /subscription_items$/);
    expect(items).toHaveLength(1);
    const form = items[0].form();
    expect(form.get("price")).toBe(env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID);
    expect(form.get("quantity")).toBe("1");
    expect(form.get("proration_behavior")).toBe("always_invoice");
    // Keyed on the request's Idempotency-Key, so a retry cannot double-charge.
    expect(items[0].headers.get("Idempotency-Key")).toBeTruthy();

    // The claim names the number being bought (so THAT one comes back, not the
    // oldest) and carries the fence epoch read before Stripe was ever asked.
    expect(harness.callsTo("POST", /rpc\/claim_number_allowance/)[0].json()).toEqual({
      p_company_id: COMPANY_ID,
      p_included: 1,
      p_paid_extras: 1,
      p_expected_epoch: 4,
      p_prefer_id: NUMBER_ID,
    });
  });

  it("#526 the body reports the CLAIM's numbers — the capacity it settled on and what is still held", async () => {
    // #526 R4: the whole success body could be replaced with the happy-path
    // literals `{reinstated: true, paid_extras: 1, allowance: 2, held: []}` and
    // all 21 tests here stayed green, because the one test that asserted the
    // body used a fixture that returned exactly those values. So a route
    // reporting a stale capacity — or an empty held list to a workspace that is
    // still holding two numbers, which is the screen telling somebody their
    // problem is solved when it is not — would have shipped.
    //
    // A Pro workspace holding three, buying back the middle one. Every figure
    // below is different from every other, and none of them is 1 or 2.
    const OTHER_HELD = [
      { id: "c2f2f7b2-3d4e-4f60-8a9b-0c1d2e3f4a5c", number_e164: "+14155550103", suspended_at: "2026-07-30T00:00:00.000Z" },
      { id: "d3f3f8c3-4e5f-4a71-8a9b-0c1d2e3f4a5d", number_e164: "+14155550104", suspended_at: "2026-07-31T00:00:00.000Z" },
    ];
    const CLAIM = {
      applied: true,
      plan_known: true,
      // 2 included on Pro + the 3 paid extras this purchase just settled on.
      allowance: PLAN_LIMITS.pro.numbers + 3,
      capacity: 3,
      capacity_fenced: false,
      restored: [{ id: NUMBER_ID, number_e164: "+14155550102" }],
      held: OTHER_HELD,
    };
    const harness = makeHarness([
      companyEndpoint(
        companyRow({ plan: "pro", paid_extra_numbers: 2, paid_capacity_epoch: 9 }),
      ),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ plan: "pro", extraQuantity: 2 }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_items\/si_extra/, () => ({
        id: "si_extra",
        object: "subscription_item",
        quantity: 3,
      })),
      claimRpc(CLAIM),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => new Response(null, { status: 201 })),
    ]);
    const response = await reinstate(harness);

    expect(response.status).toBe(200);
    // Read off the claim, not retyped: a body pinned to literals cannot pass
    // this, and neither can one that reports the figures we ASKED Stripe for.
    expect(await response.json()).toEqual({
      reinstated: true,
      paid_extras: CLAIM.capacity,
      allowance: CLAIM.allowance,
      held: CLAIM.held,
    });
  });

  it("a FENCED claim is refused with nothing charged — the #110 defect, closed", async () => {
    // The proved defect: the fence refused the capacity raise AFTER Stripe had
    // been told to bill for it, so the customer paid and the number stayed
    // held. Now the fence fires before the charge exists.
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      claimRpc({
        applied: false,
        capacity_fenced: true,
        capacity: 0,
        allowance: 1,
        restored: [],
        held: [HELD],
      }),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/try again/i);
    expect(harness.callsTo("POST", /subscription_items/)).toHaveLength(0);
  });

  it("a claim that cannot bring THAT number back charges nothing", async () => {
    // The workspace's allowance is filled by numbers that are not on hold — a
    // port mid-transfer, a row mid-provision. Buying capacity would not free
    // this number, so nothing is bought.
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      claimRpc({ applied: false, capacity: 0, allowance: 1, restored: [], held: [HELD] }),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/still being set up/i);
    expect(harness.callsTo("POST", /subscription_items/)).toHaveLength(0);
  });

  it("a claim that brought back somebody ELSE is not charged for either", async () => {
    // `applied` says the claim wrote something; the restored list says WHAT.
    // Charging on the first alone is how "we took the money and the card still
    // says on hold" gets shipped — the response has to answer for the outcome.
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      claimRpc({
        restored: [
          { id: "a0e0e5a0-1b2c-4d5e-8f9a-0b1c2d3e4f5a", number_e164: "+14155550101" },
        ],
        held: [HELD],
      }),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscription_items/)).toHaveLength(0);
  });

  it("a charge Stripe REFUSED puts the number back on hold and gives the capacity back", async () => {
    // The number was restored a moment ago and never paid for. Stripe is asked
    // what actually happened first — here it still bills the old quantity, so
    // the change did not land and ours is undone: back to the hold it was in,
    // with its original suspended_at, and the capacity lowered to what is
    // really billed so a port claim cannot spend the free slot.
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([
        {
          id: NUMBER_ID,
          status: "suspended",
          number_e164: "+14155550102",
          suspended_at: "2026-07-30T00:00:00.000Z",
        },
      ]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/subscription_items$/,
        () =>
          new Response(
            JSON.stringify({ error: { type: "card_error", message: "Your card was declined." } }),
            { status: 402 },
          ),
      ),
      claimRpc(),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => []),
    ]);
    // A declined card is nobody's clean conflict: it propagates, and the app's
    // error handler turns it into a 500 the customer can retry. What matters
    // here is that the workspace is left exactly as it was found.
    await expect(reinstate(harness)).rejects.toThrow(/declined/i);

    const rehold = harness.callsTo("PATCH", /phone_numbers/);
    expect(rehold).toHaveLength(1);
    expect(rehold[0].json()).toEqual({
      status: "suspended",
      // The hold's clock is not restarted by a purchase that failed.
      suspended_at: "2026-07-30T00:00:00.000Z",
    });
    expect(rehold[0].url.searchParams.get("status")).toBe("eq.active");

    // And the unpaid capacity is handed back — a LOWER, so it needs no epoch.
    const claims = harness.callsTo("POST", /rpc\/claim_number_allowance/);
    expect(claims).toHaveLength(2);
    expect(claims[1].json()).toMatchObject({
      p_company_id: COMPANY_ID,
      p_paid_extras: 0,
      p_prefer_id: null,
    });
  });

  it("a charge whose failure HID a change that landed keeps the number with the customer", async () => {
    // The write reached Stripe and the response did not come back. Taking the
    // number away from somebody who was billed for it is the one outcome worth
    // more than the $5 it might cost us, so the re-read decides.
    let subscriptionReads = 0;
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () => {
        subscriptionReads += 1;
        // The second read is the one after the failure: Stripe has the extra.
        return subscriptionFixture(
          subscriptionReads > 1 ? { extraQuantity: 1 } : {},
        );
      }),
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/subscription_items$/,
        () => new Response(null, { status: 500 }),
      ),
      claimRpc(),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => []),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => new Response(null, { status: 201 })),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reinstated: true, paid_extras: 1 });
    // Nothing was taken back and no capacity was returned.
    expect(harness.callsTo("PATCH", /phone_numbers/)).toHaveLength(0);
    expect(harness.callsTo("POST", /rpc\/claim_number_allowance/)).toHaveLength(1);
  });

  it("a number that is already back is not charged for again", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "active", number_e164: "+14155550102" }]),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reinstated: false, already_active: true });
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("Starter at its hard cap is refused BEFORE any money moves", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ paid_extra_numbers: 1 })),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/2 numbers/);
    expect(body.error.message).toMatch(/Pro/);
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("a paused workspace is refused before any money moves (#277)", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ paused_at: "2026-11-04T00:00:00.000Z" })),
    ]);
    const response = await reinstate(harness);
    // `workspace_paused` carries its own status (402) — the same one every
    // other paused refusal in the product answers with.
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("workspace_paused");
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("a schedule-managed subscription is refused (#18), not silently undone at rollover", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      heldRows([{ id: NUMBER_ID, status: "suspended", number_e164: "+14155550102" }]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ schedule: "sub_sched_1" }),
      ),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscription_items/)).toHaveLength(0);
  });

  it("a cancelled workspace is told to resubscribe, never refused a way back", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ subscription_status: "canceled" })),
    ]);
    const response = await reinstate(harness);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/subscription again/i);
  });

  it("422 without an Idempotency-Key — a charge with no replay protection is never sent", async () => {
    const harness = makeHarness([]);
    const response = await reinstate(harness, { key: null });
    expect(response.status).toBe(422);
    expect(harness.calls).toHaveLength(0);
  });

  it("422 for a malformed id — never a 500 for a bad request", async () => {
    const harness = makeHarness([]);
    const response = await reinstate(harness, { id: "not-a-uuid" });
    expect(response.status).toBe(422);
    expect(harness.calls).toHaveLength(0);
  });

  it("404 for a number on another workspace", async () => {
    const harness = makeHarness([companyEndpoint(companyRow()), heldRows([])]);
    const response = await reinstate(harness);
    expect(response.status).toBe(404);
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("403 for a member", async () => {
    const harness = makeHarness([]);
    const response = await reinstate(harness, { role: "member" });
    expect(response.status).toBe(403);
    expect(harness.calls).toHaveLength(0);
  });
});
