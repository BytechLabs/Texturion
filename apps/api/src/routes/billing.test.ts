/**
 * Billing route suite (SPEC §4.1 step 4, §9, §10): checkout composition per
 * plan/US-fee permutation including both 409 gates, portal, and the
 * change-plan upgrade/downgrade rules. Real product code (Hono sub-app,
 * requireRole, supabase-js, stripe-node); only global fetch is stubbed.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { billingRoutes } from "./billing";
import type { AppEnv, MemberRole } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import {
  countResponse,
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
const PERIOD_START = 1_750_000_000;
const PERIOD_END = 1_752_592_000;

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
    if (error instanceof ApiError) {
      return errorResponse(c, error.code, error.message);
    }
    throw error;
  });
  return app;
}

async function post(
  path: string,
  body: unknown,
  harness: Harness,
  role: MemberRole = "owner",
): Promise<Response> {
  stubFetch(harness.route);
  return makeApp(role).request(
    path,
    {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    env,
  );
}

async function get(
  path: string,
  harness: Harness,
  role: MemberRole = "owner",
): Promise<Response> {
  stubFetch(harness.route);
  return makeApp(role).request(path, { method: "GET" }, env);
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    plan: null,
    country: "US",
    us_texting_enabled: true,
    subscription_status: "incomplete",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    registration_fee_paid_at: null,
    // #277: not paused, which is what every workspace is unless a test says
    // otherwise. Present rather than absent so a route reading it gets null
    // and not undefined, exactly as PostgREST would answer.
    paused_at: null,
    paused_price_cents: null,
    // #110/#523: the paid extra-number capacity and its raise fence. Present
    // for the same reason `paused_at` above is — PostgREST answers the columns
    // the select asks for, and a route reading `undefined` where the database
    // would give a number is testing something that cannot happen.
    paid_extra_numbers: 0,
    paid_capacity_epoch: 0,
    ...overrides,
  };
}

const completeBrandData = {
  displayName: "Acme Plumbing",
  email: "owner@acmeplumbing.example",
  phone: "+15125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US",
  companyName: "Acme Plumbing LLC",
  ein: "12-3456789",
};
const completeCampaignData = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them.",
  sample1: "Hi — your quote from Acme Plumbing is ready.",
  sample2: "Reminder: our technician arrives tomorrow at 9am.",
};

function completeRegistrationRows() {
  return [
    { kind: "brand", status: "draft", sole_proprietor: false, data: completeBrandData },
    { kind: "campaign", status: "draft", sole_proprietor: false, data: completeCampaignData },
  ];
}

function companyEndpoint(row: Record<string, unknown>): StubEndpoint {
  return endpoint("GET", /\/rest\/v1\/companies/, () => [row]);
}

/**
 * #523: the allowance claim (`claim_number_allowance`). An upgrade raises the
 * included count, so change-plan settles the workspace's numbers against the
 * new allowance — a Starter workspace with a number on hold is exactly what
 * upgrading is supposed to fix. The default answers "nothing was on hold",
 * which is every ordinary upgrade; a test that wants the reinstatement
 * prepends its own.
 */
function allowanceRpc(
  result: Record<string, unknown> = {},
): StubEndpoint {
  return endpoint("POST", /\/rest\/v1\/rpc\/claim_number_allowance/, () => ({
    applied: true,
    plan_known: true,
    allowance: 2,
    capacity: 0,
    capacity_fenced: false,
    restored: [],
    held: [],
    ...result,
  }));
}

function checkoutSessionEndpoint(): StubEndpoint {
  return endpoint("POST", /api\.stripe\.com\/v1\/checkout\/sessions$/, () => ({
    id: "cs_1",
    url: "https://checkout.stripe.com/c/pay/cs_1",
  }));
}

function subscriptionFixture(
  overrides: {
    licensed?: string;
    metered?: string;
    schedule?: string | null;
    moduleItems?: { id: string; priceId: string }[];
    /** D36: the voice metered overage item (no quantity, meter-bound). */
    voiceMetered?: { id: string; priceId: string };
  } = {},
) {
  const {
    licensed = env.STRIPE_STARTER_PRICE_ID,
    metered = env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    schedule = null,
    moduleItems = [],
    voiceMetered,
  } = overrides;
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
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: { id: licensed, object: "price", recurring: { interval: "month" } },
        },
        {
          id: "si_metered",
          object: "subscription_item",
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: {
            id: metered,
            object: "price",
            recurring: { interval: "month", meter: "mtr_1" },
          },
        },
        ...moduleItems.map((m) => ({
          id: m.id,
          object: "subscription_item",
          quantity: 1,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: { id: m.priceId, object: "price", recurring: { interval: "month" } },
        })),
        ...(voiceMetered
          ? [
              {
                id: voiceMetered.id,
                object: "subscription_item",
                current_period_start: PERIOD_START,
                current_period_end: PERIOD_END,
                price: {
                  id: voiceMetered.priceId,
                  object: "price",
                  recurring: { interval: "month", meter: "mtr_voice_1" },
                },
              },
            ]
          : []),
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/billing/checkout — roles and body", () => {
  it("member role is 403 (owner/admin only, SPEC §10)", async () => {
    const harness = makeHarness([]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
      "member",
    );
    expect(response.status).toBe(403);
    expect(harness.calls).toHaveLength(0);
  });

  it("admin role is allowed", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: false })),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
      "admin",
    );
    expect(response.status).toBe(200);
  });

  it("#522: records the currency the customer was ACTUALLY charged in", async () => {
    // `api_create_company` guesses the currency from the country, so a Canadian
    // workspace is born saying `cad`. The Stripe catalog is USD-only until an
    // operator files the CAD amounts, so `checkoutCurrency` degrades the session
    // to USD and the customer pays in USD — while the row went on saying `cad`,
    // and every screen that quotes a price reads the row.
    //
    // That is how a card came to promise CA$39 for a fee invoiced at US$29. The
    // figure was denominated in a currency nobody was ever charged.
    const harness = makeHarness([
      companyEndpoint(
        companyRow({ country: "CA", billing_currency: "cad", us_texting_enabled: false }),
      ),
      // The catalog answers with a USD-only price, which is what live Stripe
      // holds today: all thirteen active prices carry `currency_options: [usd]`.
      endpoint("GET", /api\.stripe\.com\/v1\/prices\//, () => ({
        id: "price_starter",
        currency: "usd",
        currency_options: { usd: { unit_amount: 2900 } },
      })),
      checkoutSessionEndpoint(),
      endpoint("PATCH", /rest\/v1\/companies/, () => []),
    ]);

    const response = await post("/v1/billing/checkout", { plan: "starter" }, harness);
    expect(response.status).toBe(200);

    // The session charges USD, because that is all the catalog can do...
    expect(harness.callsTo("POST", /checkout\/sessions/)[0].form().get("currency")).toBe(
      "usd",
    );
    // ...and the row now says so too, which is the half that was missing.
    const patches = harness.callsTo("PATCH", /rest\/v1\/companies/);
    expect(patches).toHaveLength(1);
    expect(patches[0].json()).toMatchObject({ billing_currency: "usd" });
  });

  it("#522: leaves the row alone when it already matches", async () => {
    // A PATCH per checkout for a workspace that was never wrong is a write
    // nobody asked for, and it would make the audit trail read as though the
    // currency had changed.
    const harness = makeHarness([
      // A Canadian workspace already recorded as usd: the healed state, and the
      // one this must not churn a write on.
      companyEndpoint(companyRow({ country: "CA", billing_currency: "usd", us_texting_enabled: false })),
      endpoint("GET", /api\.stripe\.com\/v1\/prices\//, () => ({
        id: "price_starter",
        currency: "usd",
        currency_options: { usd: { unit_amount: 2900 } },
      })),
      checkoutSessionEndpoint(),
      // Stubbed so a stray PATCH would be COUNTED rather than hanging: an
      // unstubbed call cannot be told apart from one that never happened.
      endpoint("PATCH", /rest\/v1\/companies/, () => []),
    ]);
    const response = await post("/v1/billing/checkout", { plan: "starter" }, harness);
    expect(response.status).toBe(200);
    expect(harness.callsTo("PATCH", /rest\/v1\/companies/)).toHaveLength(0);
  });

  it("rejects a bad plan with 422", async () => {
    const harness = makeHarness([]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "enterprise" },
      harness,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
  });
});

describe("POST /v1/billing/checkout — 409 gates (SPEC §4.1 step 4)", () => {
  it.each(["active", "past_due", "unpaid"] as const)(
    "subscription_status '%s' → 409 conflict (one subscription per company, ever)",
    async (status) => {
      const harness = makeHarness([
        companyEndpoint(companyRow({ subscription_status: status })),
      ]);
      const response = await post(
        "/v1/billing/checkout",
        { plan: "starter" },
        harness,
      );
      expect(response.status).toBe(409);
      expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
    },
  );

  it("US company with NO registration rows → checkout proceeds (#381/#458)", async () => {
    // The `business` step moved behind the paywall, so an empty registration
    // is the normal pre-checkout state for every new US signup. Refusing here
    // would 409 all of them. Submission is still safe: `submitRegistration`
    // no-ops on an incomplete draft, and the trigger in routes/registration.ts
    // fires when the details land.
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).not.toBe(409);
  });

  it("US company with an incomplete campaign draft → 409", async () => {
    const rows = completeRegistrationRows();
    rows[1].data = { ...completeCampaignData, sample2: "  " };
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => rows),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
  });

  it("CA company owing US registration is treated the same as a US one", async () => {
    // #381/#458: same reordering, same empty-is-fine rule. What matters is
    // that the CA-owing branch still runs the gate at all — a PARTIAL draft
    // must still be refused here, which the test above covers.
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: true })),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).not.toBe(409);
  });
});

describe("POST /v1/billing/checkout — session composition (SPEC §9)", () => {
  it("US company, fee unpaid: licensed + metered (no quantity) + one-time fee", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      endpoint(
        "GET",
        /\/rest\/v1\/messaging_registrations/,
        completeRegistrationRows,
      ),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });

    const form = harness.callsTo("POST", /checkout\/sessions/)[0].form();
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("client_reference_id")).toBe(COMPANY_ID);
    expect(form.get("automatic_tax[enabled]")).toBe("true");
    // Promo/coupon field shown at checkout (marketing promos + comp accounts).
    expect(form.get("allow_promotion_codes")).toBe("true");
    expect(form.get("line_items[0][price]")).toBe(env.STRIPE_STARTER_PRICE_ID);
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[1][price]")).toBe(
      env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    );
    // Metered items must NOT carry a quantity (SPEC §9).
    expect(form.has("line_items[1][quantity]")).toBe(false);
    expect(form.get("line_items[2][price]")).toBe(env.STRIPE_US_FEE_PRICE_ID);
    expect(form.get("line_items[2][quantity]")).toBe("1");
    // #134/D42: calling is included on every plan — EVERY checkout carries the
    // per-plan voice metered overage price (no quantity — metered).
    expect(form.get("line_items[3][price]")).toBe(
      env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID,
    );
    expect(form.has("line_items[3][quantity]")).toBe(false);
    expect(form.has("line_items[4][price]")).toBe(false);
    expect(form.get("success_url")).toBe(
      `${env.APP_ORIGIN}/onboarding/setting-up?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(form.get("cancel_url")).toBe(
      `${env.APP_ORIGIN}/onboarding/plan?checkout=canceled`,
    );
    expect(form.has("customer")).toBe(false);

    // §9 double-charge fail-safe: a stable, cart-derived Idempotency-Key so two
    // concurrent identical submits collapse to ONE Checkout Session (Stripe
    // replays the first) — a double-click can never start two subscriptions.
    //
    // #260: the key is derived from the LINE ITEMS now, not from plan + modules.
    // It used to omit the $29 fee line, whose inputs (country,
    // us_texting_enabled) are editable on the plan step between attempts BY
    // DESIGN — so changing the US answer resent the SAME key with DIFFERENT
    // parameters, Stripe answered idempotency_error, and checkout was blocked
    // for roughly a day with no other cart input available to change.
    const feeCartKey = harness
      .callsTo("POST", /checkout\/sessions/)[0]
      .headers.get("Idempotency-Key");
    expect(feeCartKey).toContain(`${COMPANY_ID}:checkout:`);
    // The fee line is IN the key, which is the whole fix.
    expect(feeCartKey).toContain(env.STRIPE_US_FEE_PRICE_ID);
  });

  it("US company, fee already paid: no one-time line (never charged twice, SPEC §2)", async () => {
    const harness = makeHarness([
      companyEndpoint(
        companyRow({ registration_fee_paid_at: "2026-01-01T00:00:00Z" }),
      ),
      endpoint(
        "GET",
        /\/rest\/v1\/messaging_registrations/,
        completeRegistrationRows,
      ),
      checkoutSessionEndpoint(),
    ]);
    await post("/v1/billing/checkout", { plan: "starter" }, harness);
    const form = harness.callsTo("POST", /checkout\/sessions/)[0].form();
    expect(form.get("line_items[1][price]")).toBe(
      env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    );
    // No fee line — [2] is the always-present voice metered price (#134).
    expect(form.get("line_items[2][price]")).toBe(
      env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID,
    );
    expect(form.has("line_items[3][price]")).toBe(false);

    // #260: the same plan WITHOUT the fee line must not reuse the fee cart's
    // key. This is the exact collision that hard-blocked checkout: a customer
    // toggles their US answer on the plan step, the cart changes, the key did
    // not, and Stripe refuses a reused key whose parameters differ.
    const noFeeKey = harness
      .callsTo("POST", /checkout\/sessions/)[0]
      .headers.get("Idempotency-Key");
    expect(noFeeKey).toContain(`${COMPANY_ID}:checkout:`);
    expect(noFeeKey).not.toContain(env.STRIPE_US_FEE_PRICE_ID);
  });

  it("CA company with US texting off: pro price pair, no fee, wizard skipped", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: false })),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "pro" },
      harness,
    );
    expect(response.status).toBe(200);
    // No registration lookup at all — the gate does not apply (SPEC §4.2).
    expect(harness.callsTo("GET", /messaging_registrations/)).toHaveLength(0);
    const form = harness.callsTo("POST", /checkout\/sessions/)[0].form();
    expect(form.get("line_items[0][price]")).toBe(env.STRIPE_PRO_PRICE_ID);
    expect(form.get("line_items[1][price]")).toBe(env.STRIPE_PRO_OVERAGE_PRICE_ID);
    // #134/D42: the voice metered price rides every cart on the PLAN's
    // tiering — Pro cart, Pro tiering (allowance 6,000, then 1¢/min).
    expect(form.get("line_items[2][price]")).toBe(
      env.STRIPE_PRO_VOICE_OVERAGE_PRICE_ID,
    );
    expect(form.has("line_items[2][quantity]")).toBe(false);
    expect(form.has("line_items[3][price]")).toBe(false);
  });

  it("retired module ids (voice, extra_storage) are silently DROPPED at checkout — deploy-skew tolerance (#134 review)", async () => {
    // A stale pre-D42 bundle still selling the $8 Calling add-on must not
    // dead-end at the pay button: retired ids are stripped and checkout
    // proceeds WITHOUT them (voice's capability is included/free now).
    const session = endpoint(
      "POST",
      /api\.stripe\.com\/v1\/checkout\/sessions/,
      () => ({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }),
    );
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: false })),
      session,
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter", modules: ["voice", "extra_storage"] },
      harness,
    );
    expect(response.status).toBe(200);
    const creates = harness.callsTo("POST", /checkout\/sessions/);
    expect(creates).toHaveLength(1);
    const form = String(creates[0].body);
    // No retired module price ever reaches Stripe.
    expect(form).not.toContain(env.STRIPE_MODULE_VOICE_PRICE_ID!);
    expect(form).not.toContain(env.STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID!);
  });

  it("an id that was NEVER a module is still a 422 at checkout", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: false })),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter", modules: ["premium_unicorns"] },
      harness,
    );
    expect(response.status).toBe(422);
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("regions_ca is not sellable: checkout refuses it server-side (#41)", async () => {
    // The module is admittedly inert (nothing reads it yet) — selling it would
    // charge $5/mo for nothing, so the server refuses even though a price is
    // provisioned and the enum accepts the value.
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: false })),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter", modules: ["regions_ca"] },
      harness,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("resubscribe after cancellation: allowed, reuses the Stripe customer, no second fee", async () => {
    const harness = makeHarness([
      companyEndpoint(
        companyRow({
          subscription_status: "canceled",
          stripe_customer_id: "cus_1",
          registration_fee_paid_at: "2026-01-01T00:00:00Z",
          plan: "starter",
        }),
      ),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => [
        // Post-payment rows from the first life: submittable as-is (§4.4).
        { kind: "brand", status: "approved", sole_proprietor: false, data: {} },
        {
          kind: "campaign",
          status: "approved",
          sole_proprietor: false,
          data: {},
        },
      ]),
      checkoutSessionEndpoint(),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(200);
    const form = harness.callsTo("POST", /checkout\/sessions/)[0].form();
    expect(form.get("customer")).toBe("cus_1");
    // No second fee — [2] is the always-present voice metered price (#134).
    expect(form.get("line_items[2][price]")).toBe(
      env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID,
    );
    expect(form.has("line_items[3][price]")).toBe(false);
  });
});

describe("POST /v1/billing/confirm-checkout (webhook-independent activation)", () => {
  function sessionRetrieveEndpoint(
    session: Record<string, unknown>,
  ): StubEndpoint {
    return endpoint(
      "GET",
      /api\.stripe\.com\/v1\/checkout\/sessions\/[^/?]+$/,
      () => ({ id: "cs_x", object: "checkout.session", ...session }),
    );
  }

  it("422 when the body carries no sessionId", async () => {
    const harness = makeHarness([]);
    const response = await post("/v1/billing/confirm-checkout", {}, harness);
    expect(response.status).toBe(422);
  });

  it("403 for a member — owner/admin only", async () => {
    const harness = makeHarness([]);
    const response = await post(
      "/v1/billing/confirm-checkout",
      { sessionId: "cs_x" },
      harness,
      "member",
    );
    expect(response.status).toBe(403);
  });

  it("403 when the session belongs to a different company (never activate off a foreign session)", async () => {
    const harness = makeHarness([
      sessionRetrieveEndpoint({
        client_reference_id: "00000000-0000-0000-0000-000000000000",
        payment_status: "paid",
      }),
    ]);
    const response = await post(
      "/v1/billing/confirm-checkout",
      { sessionId: "cs_x" },
      harness,
    );
    expect(response.status).toBe(403);
  });

  it("returns { confirmed: false } while the session has not settled to paid", async () => {
    const harness = makeHarness([
      sessionRetrieveEndpoint({
        client_reference_id: COMPANY_ID,
        payment_status: "unpaid",
      }),
    ]);
    const response = await post(
      "/v1/billing/confirm-checkout",
      { sessionId: "cs_x" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmed: false });
  });
});

describe("POST /v1/billing/cancellation-reason (#277)", () => {
  // THROUGH AN RPC, not a PostgREST upsert, and the reason is worth keeping in
  // front of whoever edits this next. The table's unique index is PARTIAL
  // (`(company_id) where confirmed_at is null`), a `.upsert()` can only send a
  // bare `on_conflict=company_id`, and Postgres will not match a bare column
  // list to a partial index: every call raised 42P10 and 500ed.
  //
  // These tests could not see that, because they stub the HTTP layer and the
  // request WAS sent, faithfully, on the way to an error. The suite that can
  // fail is supabase/tests/cancellation_reason_upsert.test.sql, which calls the
  // function against a real database. What is pinned here is only what this
  // layer owns: the shape of the call and the validation in front of it.
  const RPC = /rest\/v1\/rpc\/api_record_cancellation_reason/;

  it("accepts a reason and their own words", async () => {
    const harness = makeHarness([endpoint("POST", RPC, () => null)]);
    const response = await post(
      "/v1/billing/cancellation-reason",
      { reason: "seasonal", detail: "Quiet until spring, back in March." },
      harness,
    );
    expect(response.status).toBe(204);
    expect(harness.callsTo("POST", RPC)[0].json()).toMatchObject({
      p_reason: "seasonal",
      p_detail: "Quiet until spring, back in March.",
    });
  });

  it("accepts a SKIPPED question, because a reason we cannot skip is one we cannot trust", async () => {
    // #277's own devil's advocate is binding here: cancelling must never take
    // more steps than subscribing did. An empty body is a valid record that
    // somebody declined to answer, not a 422.
    const harness = makeHarness([endpoint("POST", RPC, () => null)]);
    const response = await post("/v1/billing/cancellation-reason", {}, harness);
    expect(response.status).toBe(204);
    expect(harness.callsTo("POST", RPC)[0].json()).toMatchObject({
      p_reason: null,
      p_detail: null,
    });
  });

  it("records the statement through the function that can name the partial index", async () => {
    // Naming the RPC is the point. A future edit back to
    // `.upsert(..., { onConflict: "company_id" })` reads like a simplification
    // and is the exact 500 this route already shipped once.
    const harness = makeHarness([endpoint("POST", RPC, () => null)]);
    await post("/v1/billing/cancellation-reason", { reason: "cost" }, harness);
    expect(harness.callsTo("POST", RPC)).toHaveLength(1);
    expect(harness.callsTo("POST", /rest\/v1\/cancellation_reasons/)).toHaveLength(0);
  });

  it("422s a reason code longer than the column allows", async () => {
    const harness = makeHarness([endpoint("POST", RPC, () => null)]);
    const response = await post(
      "/v1/billing/cancellation-reason",
      { reason: "x".repeat(41) },
      harness,
    );
    expect(response.status).toBe(422);
    expect(harness.callsTo("POST", RPC)).toHaveLength(0);
  });
});

describe("GET /v1/billing/cancellation-reason (#277 follow-up)", () => {
  // The win-back card reads this during the grace window to answer the reason
  // that was given on the way out. It is a route rather than a company_view
  // field on purpose: loadCompanyView runs on every app boot for every role,
  // and this answer is non-null only for a workspace that has already left.
  const READ = /rest\/v1\/cancellation_reasons/;

  it("reads back the OPEN statement", async () => {
    const harness = makeHarness([
      endpoint("GET", READ, () => [
        { reason: "seasonal", created_at: "2026-03-01T00:00:00Z" },
      ]),
    ]);
    const response = await get("/v1/billing/cancellation-reason", harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reason: "seasonal",
      stated_at: "2026-03-01T00:00:00Z",
    });
  });

  it("asks for the open row only — a confirmed one is a finished conversation", async () => {
    // Without `confirmed_at is null` the card would answer a reason from a
    // cancellation that ran its course a year ago, which is the shape the
    // partial unique index exists to keep at-most-one of.
    const harness = makeHarness([endpoint("GET", READ, () => [])]);
    await get("/v1/billing/cancellation-reason", harness);
    const url = harness.callsTo("GET", READ)[0].url;
    expect(url.searchParams.get("confirmed_at")).toBe("is.null");
    expect(url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("never reads back their own words", async () => {
    // `detail` is what somebody wrote about us. Quoting it back at them on a
    // win-back card would be the product arguing with its own transcript.
    const harness = makeHarness([endpoint("GET", READ, () => [])]);
    await get("/v1/billing/cancellation-reason", harness);
    const select = harness.callsTo("GET", READ)[0].url.searchParams.get("select");
    expect(select).not.toContain("detail");
  });

  it("answers null when nobody ever said why, and when nobody cancelled", async () => {
    // Both render nothing, and they are different facts: a row with a null
    // reason is somebody who opened the screen and declined to answer, which
    // is allowed on purpose and is counted separately in the report.
    const skipped = makeHarness([
      endpoint("GET", READ, () => [
        { reason: null, created_at: "2026-03-01T00:00:00Z" },
      ]),
    ]);
    expect(await (await get("/v1/billing/cancellation-reason", skipped)).json())
      .toEqual({ reason: null, stated_at: "2026-03-01T00:00:00Z" });

    const none = makeHarness([endpoint("GET", READ, () => [])]);
    expect(await (await get("/v1/billing/cancellation-reason", none)).json())
      .toEqual({ reason: null, stated_at: null });
  });
});

describe("POST /v1/billing/dismiss-winback (#277 follow-up)", () => {
  const COMPANIES = /rest\/v1\/companies/;

  it("stamps a timestamp on this company and answers 204", async () => {
    const harness = makeHarness([endpoint("PATCH", COMPANIES, () => [])]);
    const response = await post("/v1/billing/dismiss-winback", undefined, harness);
    expect(response.status).toBe(204);

    const call = harness.callsTo("PATCH", COMPANIES)[0];
    expect(call.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("deleted_at")).toBe("is.null");
    // A TIMESTAMP, not a boolean. The suppression rule compares it against
    // canceled_at, which is what makes a dismissal belong to ONE cancellation:
    // a later cancellation stamps a newer canceled_at and the offer returns
    // with nothing to clear. A boolean would silence the second cancellation
    // with a decision made about the first.
    const written = call.json() as { winback_dismissed_at: string };
    expect(Number.isNaN(Date.parse(written.winback_dismissed_at))).toBe(false);
    expect(Object.keys(written)).toEqual(["winback_dismissed_at"]);
  });

  it("does not require a cancellation to exist first", async () => {
    // Deliberate: a stamp written while nothing is cancelled suppresses
    // nothing, because the next canceled_at is later than it. A guard would
    // only add a way for a legitimate press to fail.
    const harness = makeHarness([endpoint("PATCH", COMPANIES, () => [])]);
    expect(
      (await post("/v1/billing/dismiss-winback", undefined, harness)).status,
    ).toBe(204);
  });
});

describe("POST /v1/billing/portal", () => {
  it("409 before any checkout (no Stripe customer)", async () => {
    const harness = makeHarness([companyEndpoint(companyRow())]);
    const response = await post("/v1/billing/portal", undefined, harness);
    expect(response.status).toBe(409);
  });

  it("creates a portal session for the company's customer", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ stripe_customer_id: "cus_1" })),
      endpoint("POST", /api\.stripe\.com\/v1\/billing_portal\/sessions/, () => ({
        id: "bps_1",
        url: "https://billing.stripe.com/p/session/bps_1",
      })),
    ]);
    const response = await post("/v1/billing/portal", undefined, harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.com/p/session/bps_1",
      // #421: the OWNER gets the whole portal, cancellation included.
      scope: "full",
    });
    const form = harness.callsTo("POST", /billing_portal/)[0].form();
    expect(form.get("customer")).toBe("cus_1");
    expect(form.get("return_url")).toBe(`${env.APP_ORIGIN}/settings/billing`);
    // No flow restriction for the owner.
    expect(form.get("flow_data[type]")).toBeNull();
  });

  it("#421: an ADMIN gets the card-update flow, with no route to cancellation", async () => {
    // Closing the workspace is owner-only, and cancelling ends in the same
    // place: `grace.ts` releases the number 30 days later and a released number
    // is reassigned to another business (#413). That path was admin-reachable
    // purely because it happened on Stripe's domain.
    //
    // Admin billing is still right for the ordinary case — a bookkeeper
    // updating an expiring card should not have to be the owner (#332). So the
    // route stays admin-reachable and the BUNDLE is split instead: the
    // payment_method_update flow has no cancellation surface at all, which is a
    // structural limit rather than a hidden button.
    const harness = makeHarness([
      companyEndpoint(companyRow({ stripe_customer_id: "cus_1" })),
      endpoint("POST", /api\.stripe\.com\/v1\/billing_portal\/sessions/, () => ({
        id: "bps_2",
        url: "https://billing.stripe.com/p/session/bps_2",
      })),
    ]);
    const response = await post("/v1/billing/portal", undefined, harness, "admin");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scope: "payment_method" });

    const form = harness.callsTo("POST", /billing_portal/)[0].form();
    expect(form.get("flow_data[type]")).toBe("payment_method_update");
  });
});

describe("POST /v1/billing/change-plan (SPEC §9 plan changes)", () => {
  const activeStarter = () =>
    companyRow({
      plan: "starter",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });
  const activePro = () =>
    companyRow({
      plan: "pro",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });
  const proSubscription = (schedule: string | null = null) =>
    subscriptionFixture({
      licensed: env.STRIPE_PRO_PRICE_ID,
      metered: env.STRIPE_PRO_OVERAGE_PRICE_ID,
      schedule,
    });

  it("409 when there is no subscription yet", async () => {
    const harness = makeHarness([companyEndpoint(companyRow())]);
    const response = await post("/v1/billing/change-plan", { plan: "pro" }, harness);
    expect(response.status).toBe(409);
  });

  it("409 when already on the requested plan", async () => {
    const harness = makeHarness([companyEndpoint(activeStarter())]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
  });

  it("409s with a real sentence when the workspace is paused — never a 500", async () => {
    /**
     * #277. A paused subscription carries the PAUSE price on its licensed
     * item, so the licensed+metered pair lookup below finds nothing and hits
     * the invariant `throw` — which becomes `internal_error`, "Something went
     * wrong", and a Sentry alert, for a perfectly ordinary thing to try.
     *
     * Refused rather than performed because the request is genuinely ambiguous
     * and only the customer can settle it: resume now on the new plan, or keep
     * paying the holding fee and land on it in spring?
     */
    const harness = makeHarness([
      companyEndpoint(
        companyRow({
          plan: "starter",
          subscription_status: "active",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
          paused_at: "2026-11-04T00:00:00.000Z",
          paused_price_cents: 500,
        }),
      ),
    ]);
    const response = await post("/v1/billing/change-plan", { plan: "pro" }, harness);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toMatch(/paused/i);
    expect(body.error.message).toMatch(/resume/i);
    // And it never reached Stripe: no half-done swap to unwind.
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("upgrade swaps both items to Pro with always_invoice proration, immediately", async () => {
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      allowanceRpc(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "pro" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plan: "pro",
      effective: "now",
      reinstated: [],
      held: [],
    });

    const form = harness.callsTo("POST", /subscriptions\/sub_1/)[0].form();
    expect(form.get("items[0][id]")).toBe("si_licensed");
    expect(form.get("items[0][price]")).toBe(env.STRIPE_PRO_PRICE_ID);
    expect(form.get("items[1][id]")).toBe("si_metered");
    expect(form.get("items[1][price]")).toBe(env.STRIPE_PRO_OVERAGE_PRICE_ID);
    expect(form.get("proration_behavior")).toBe("always_invoice");

    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(1);
    expect(patches[0].json()).toEqual({ plan: "pro" });
  });

  it("#523 upgrading brings a HELD number back, and says which one", async () => {
    // The other way out of a hold. A workspace that came back on Starter
    // holding two numbers has one suspended; Pro includes two, so the upgrade
    // has to settle the numbers against the new allowance. Without this the
    // owner pays $79 and their second line is still dead, which reads as the
    // upgrade not having worked.
    const back = {
      id: "b1f1f6a1-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
      number_e164: "+14155550102",
    };
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      allowanceRpc({ restored: [back] }),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    const response = await post("/v1/billing/change-plan", { plan: "pro" }, harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plan: "pro",
      effective: "now",
      reinstated: [back],
      held: [],
    });

    const claims = harness.callsTo("POST", /rpc\/claim_number_allowance/);
    expect(claims).toHaveLength(1);
    expect(claims[0].json()).toEqual({
      p_company_id: COMPANY_ID,
      // PLAN_LIMITS.pro.numbers — the allowance they just bought.
      p_included: 2,
      // The upgrade migrates the extra item's price, never its quantity.
      p_paid_extras: 0,
      p_expected_epoch: 0,
      // An upgrade settles the WHOLE workspace against the bigger allowance,
      // oldest-first. Only the paid reinstate names one number.
      p_prefer_id: null,
    });
  });

  it("upgrade swaps the voice metered item to the Pro tiering too (D36)", async () => {
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        // #134: every subscription carries the voice metered item now.
        subscriptionFixture({
          voiceMetered: {
            id: "si_voice_metered",
            priceId: env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID!,
          },
        }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      allowanceRpc(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "pro" },
      harness,
    );
    expect(response.status).toBe(200);

    const form = harness.callsTo("POST", /subscriptions\/sub_1/)[0].form();
    // Left on the Starter voice price, minutes 2,500–6,000 (included on Pro)
    // would wrongly bill 1¢ each — the item must move with the plan.
    expect(form.get("items[2][id]")).toBe("si_voice_metered");
    expect(form.get("items[2][price]")).toBe(
      env.STRIPE_PRO_VOICE_OVERAGE_PRICE_ID,
    );
    expect(form.has("items[2][quantity]")).toBe(false);
  });

  it("downgrade is blocked (409) while an extra number is held", async () => {
    const harness = makeHarness([
      companyEndpoint(activePro()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(2)),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscription_schedules/)).toHaveLength(0);
  });

  it("downgrade is blocked (409) while members exceed the Starter seats", async () => {
    const harness = makeHarness([
      companyEndpoint(activePro()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(1)),
      // 4 members > the Starter cap of 3 (#83) — must deactivate first.
      endpoint("HEAD", /\/rest\/v1\/company_members/, () => countResponse(4)),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscription_schedules/)).toHaveLength(0);
  });

  it("downgrade within limits schedules Starter at period end (no immediate change)", async () => {
    const harness = makeHarness([
      companyEndpoint(activePro()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(1)),
      endpoint("HEAD", /\/rest\/v1\/company_members/, () => countResponse(3)),
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_schedules$/, () => ({
        id: "sub_sched_1",
        object: "subscription_schedule",
        current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
        phases: [{ start_date: PERIOD_START, end_date: PERIOD_END }],
      })),
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/subscription_schedules\/sub_sched_1/,
        () => ({ id: "sub_sched_1", object: "subscription_schedule" }),
      ),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plan: "starter",
      effective: "period_end",
      effective_at: new Date(PERIOD_END * 1000).toISOString(),
    });

    const create = harness.callsTo(
      "POST",
      /subscription_schedules$/,
    )[0].form();
    expect(create.get("from_subscription")).toBe("sub_1");

    const update = harness.callsTo(
      "POST",
      /subscription_schedules\/sub_sched_1/,
    )[0].form();
    expect(update.get("end_behavior")).toBe("release");
    // Phase 1: today's Pro items, unchanged, through the period end.
    expect(update.get("phases[0][items][0][price]")).toBe(env.STRIPE_PRO_PRICE_ID);
    expect(update.get("phases[0][items][0][quantity]")).toBe("1");
    expect(update.get("phases[0][items][1][price]")).toBe(
      env.STRIPE_PRO_OVERAGE_PRICE_ID,
    );
    expect(update.has("phases[0][items][1][quantity]")).toBe(false);
    expect(update.get("phases[0][start_date]")).toBe(String(PERIOD_START));
    expect(update.get("phases[0][end_date]")).toBe(String(PERIOD_END));
    // Phase 2: Starter from the rollover on.
    expect(update.get("phases[1][items][0][price]")).toBe(
      env.STRIPE_STARTER_PRICE_ID,
    );
    expect(update.get("phases[1][items][0][quantity]")).toBe("1");
    expect(update.get("phases[1][items][1][price]")).toBe(
      env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    );
    expect(update.has("phases[1][items][1][quantity]")).toBe(false);

    // Plan mirror waits for the rollover webhook — no immediate write.
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
  });

  it("downgrade preserves purchased add-on modules in the period-end phase (#12), dropping retired ones (#134)", async () => {
    const harness = makeHarness([
      companyEndpoint(activePro()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          licensed: env.STRIPE_PRO_PRICE_ID,
          metered: env.STRIPE_PRO_OVERAGE_PRICE_ID,
          moduleItems: [
            // A live catalog module rolls over…
            { id: "si_ca", priceId: env.STRIPE_MODULE_REGIONS_CA_PRICE_ID! },
            // …a RETIRED voice licensed item (pre-#134 subscriber the daily
            // sweep hasn't reached yet) must NOT be pinned into phase 2.
            { id: "si_voice", priceId: env.STRIPE_MODULE_VOICE_PRICE_ID! },
          ],
          voiceMetered: {
            id: "si_voice_metered",
            priceId: env.STRIPE_PRO_VOICE_OVERAGE_PRICE_ID!,
          },
        }),
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(1)),
      endpoint("HEAD", /\/rest\/v1\/company_members/, () => countResponse(3)),
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_schedules$/, () => ({
        id: "sub_sched_1",
        object: "subscription_schedule",
        current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
        phases: [{ start_date: PERIOD_START, end_date: PERIOD_END }],
      })),
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/subscription_schedules\/sub_sched_1/,
        () => ({ id: "sub_sched_1", object: "subscription_schedule" }),
      ),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(200);

    const update = harness.callsTo(
      "POST",
      /subscription_schedules\/sub_sched_1/,
    )[0].form();
    // Phase 2 = base Starter pair + the preserved catalog module, so the
    // add-on keeps being billed instead of being silently dropped at period
    // end. The retired voice licensed item is NOT carried (#134).
    expect(update.get("phases[1][items][0][price]")).toBe(
      env.STRIPE_STARTER_PRICE_ID,
    );
    expect(update.get("phases[1][items][1][price]")).toBe(
      env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    );
    expect(update.get("phases[1][items][2][price]")).toBe(
      env.STRIPE_MODULE_REGIONS_CA_PRICE_ID,
    );
    expect(update.get("phases[1][items][2][quantity]")).toBe("1");
    // D36: the voice metered item rolls over on the STARTER tiering — the Pro
    // price left in place would under-bill (treats up to 6,000 min as
    // included). Metered: no quantity.
    expect(update.get("phases[1][items][3][price]")).toBe(
      env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID,
    );
    expect(update.has("phases[1][items][3][quantity]")).toBe(false);
    // #134: the retired $8 voice item never rolls into the next phase.
    expect(update.has("phases[1][items][4][price]")).toBe(false);
    const phase2Prices = [...update.entries()]
      .filter(([key]) => key.startsWith("phases[1][items]"))
      .map(([, value]) => value);
    expect(phase2Prices).not.toContain(env.STRIPE_MODULE_VOICE_PRICE_ID);
  });

  it("downgrade reuses an existing schedule instead of creating one", async () => {
    const harness = makeHarness([
      companyEndpoint(activePro()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription("sub_sched_9"),
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(1)),
      endpoint("HEAD", /\/rest\/v1\/company_members/, () => countResponse(2)),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/subscription_schedules\/sub_sched_9/,
        () => ({
          id: "sub_sched_9",
          object: "subscription_schedule",
          current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
          phases: [{ start_date: PERIOD_START, end_date: PERIOD_END }],
        }),
      ),
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/subscription_schedules\/sub_sched_9/,
        () => ({ id: "sub_sched_9", object: "subscription_schedule" }),
      ),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(harness.callsTo("POST", /subscription_schedules$/)).toHaveLength(0);
    expect(
      harness.callsTo("POST", /subscription_schedules\/sub_sched_9/),
    ).toHaveLength(1);
  });
});

describe("plan-builder modules (#12)", () => {
  const activeStarter = () =>
    companyRow({
      plan: "starter",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });

  it("GET /modules lists the catalog with enabled state", async () => {
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /\/rest\/v1\/company_modules/, () => [
        { module: "regions_ca" },
        // #121/#134: pre-migration straggler rows on retired modules are
        // dropped defensively, exactly like any unknown value.
        { module: "extra_storage" },
        { module: "voice" },
      ]),
    ]);
    const response = await get("/v1/billing/modules", harness);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      modules: {
        id: string;
        enabled: boolean;
        monthly_cents: number;
        currency: string;
      }[];
    };
    const regions = body.modules.find((m) => m.id === "regions_ca");
    expect(regions?.enabled).toBe(true);
    // #522: the module price says which money it is in. It is genuinely USD —
    // `stripe-setup.ts` files no CAD option on module prices, and regions_ca is
    // not sellable, so no CAD figure has ever been decided. Stating it lets a
    // Canadian client render "US$5/mo" instead of a bare "$5", which to that
    // reader means CAD.
    expect(regions?.monthly_cents).toBe(500);
    expect(regions?.currency).toBe("usd");
    // #103/#121/#134: the catalog is exactly regions_ca — the retired mms,
    // extra_storage, and voice modules are gone entirely (not even as
    // disabled): calling is included on every plan now.
    expect(body.modules).toHaveLength(1);
    expect(body.modules.find((m) => m.id === "mms")).toBeUndefined();
    expect(body.modules.find((m) => m.id === "extra_storage")).toBeUndefined();
    expect(body.modules.find((m) => m.id === "voice")).toBeUndefined();
  });

  // #490 — the argument for reinstating, with evidence attached.
  describe("GET /missed-while-off", () => {
    // PostgREST answers a `head: true` count in the Content-Range header and
    // sends no body, which is why this returns a real Response rather than a
    // value: the count never travels as JSON.
    const countResponse = (count: number) =>
      new Response(null, {
        status: 200,
        headers: { "content-range": `*/${count}` },
      });

    it("counts the calls that reached a line which could not take them", async () => {
      const harness = makeHarness([
        endpoint("HEAD", /\/rest\/v1\/calls/, () => countResponse(7)),
        endpoint("GET", /\/rest\/v1\/calls/, () => [
          { started_at: "2026-07-30T18:00:00.000Z" },
        ]),
        companyEndpoint(activeStarter()),
      ]);
      const response = await get("/v1/billing/missed-while-off", harness);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        count: number;
        since: string;
        last_at: string | null;
      };
      expect(body.count).toBe(7);
      // Says WHEN, not only how many: "someone rang yesterday" is a different
      // sentence from "someone rang in April", and only one is worth acting on.
      expect(body.last_at).toBe("2026-07-30T18:00:00.000Z");
      // Bounded, so a number left off for months does not grow an unbounded
      // count of customers who have long since gone elsewhere.
      const days = (Date.now() - Date.parse(body.since)) / 86_400_000;
      expect(days).toBeGreaterThan(89);
      expect(days).toBeLessThan(91);
    });

    it("asks only for calls that were actually unattended", async () => {
      // The guard that matters: this must never report a company's ordinary
      // missed calls as evidence that suspension cost them business.
      const seen: URL[] = [];
      const harness = makeHarness([
        endpoint("HEAD", /\/rest\/v1\/calls/, (call) => {
          seen.push(call.url);
          return countResponse(0);
        }),
        endpoint("GET", /\/rest\/v1\/calls/, (call) => {
          seen.push(call.url);
          return [];
        }),
        companyEndpoint(activeStarter()),
      ]);
      await get("/v1/billing/missed-while-off", harness);
      expect(seen.length).toBeGreaterThan(0);
      for (const url of seen) {
        expect(url.searchParams.get("unattended")).toBe("eq.true");
        expect(url.searchParams.get("company_id")).toContain("eq.");
      }
    });
  });

  it("POST /modules 409 without a subscription", async () => {
    const harness = makeHarness([companyEndpoint(companyRow())]);
    const response = await post(
      "/v1/billing/modules",
      { module: "regions_ca", enabled: true },
      harness,
    );
    expect(response.status).toBe(409);
  });

  it("POST /modules is a clean 409 on a canceled subscription — no Stripe write attempted (#44)", async () => {
    // A canceled-in-grace company keeps stripe_subscription_id + plan, so the
    // no-subscription gate alone let the route reach Stripe (unhandled 500).
    const harness = makeHarness([
      companyEndpoint(
        companyRow({
          plan: "starter",
          subscription_status: "canceled",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
        }),
      ),
    ]);
    const response = await post(
      "/v1/billing/modules",
      { module: "regions_ca", enabled: true },
      harness,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message: expect.stringContaining("resubscribe"),
      },
    });
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("regions_ca is not sellable: the toggle refuses it and GET reports available:false (#41)", async () => {
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /\/rest\/v1\/company_modules/, () => []),
    ]);
    const toggle = await post(
      "/v1/billing/modules",
      { module: "regions_ca", enabled: true },
      harness,
    );
    expect(toggle.status).toBe(422);
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);

    const catalog = await get("/v1/billing/modules", harness);
    const body = (await catalog.json()) as {
      modules: { id: string; available: boolean }[];
    };
    expect(body.modules.find((m) => m.id === "regions_ca")?.available).toBe(false);
    // #103: mms is retired — not merely unavailable, absent from the catalog.
    expect(body.modules.find((m) => m.id === "mms")).toBeUndefined();

    // Retired ids at the toggle: mms/extra_storage are plain 422s (gone from
    // the enum); voice gets the HONEST 409 (#134 deploy skew — a stale
    // settings bundle learns calling is included, never a generic error).
    for (const retired of ["mms", "extra_storage"]) {
      const retiredToggle = await post(
        "/v1/billing/modules",
        { module: retired, enabled: true },
        harness,
      );
      expect(retiredToggle.status, retired).toBe(422);
    }
    const voiceToggle = await post(
      "/v1/billing/modules",
      { module: "voice", enabled: true },
      harness,
    );
    expect(voiceToggle.status).toBe(409);
    expect(
      ((await voiceToggle.json()) as { error: { message: string } }).error
        .message,
    ).toContain("included on every plan");
  });
});

/**
 * #277 — the seasonal pause, at the routes.
 *
 * The mechanism is a licensed-price swap on the SAME subscription, and every
 * assertion here is about a way that could go wrong quietly: swapping the wrong
 * item, pausing without a provisioned price, or letting a price id reach a
 * client.
 */
describe("#277 the seasonal pause", () => {
  const activePaused = () =>
    companyRow({
      plan: "starter",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      paused_at: "2026-11-04T00:00:00.000Z",
      paused_price_cents: 500,
    });
  const activeUnpaused = () =>
    companyRow({
      plan: "starter",
      subscription_status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
    });

  /** Everything a swap touches after the Stripe write: the mirror + the audit. */
  function afterSwapEndpoints(): StubEndpoint[] {
    return [
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme", canceled_at: null, company_modules: [] },
      ]),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => [{ id: "a1" }]),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      // #399/#277: a resume pays whatever qualified while the workspace was
      // paused. Nothing owed is the ambient case.
      endpoint("GET", /\/rest\/v1\/referrals/, () => []),
    ];
  }

  /**
   * The company row as it reads on successive fetches.
   *
   * POST /resume answers from a RE-READ rather than from a constant, so a
   * fixture that returned the same row forever would assert nothing about that —
   * a hardcoded `paused_at: null` passes against a row that still says paused.
   * Only the billing route's own select advances the sequence: `rewardSide`
   * reads this table too, and counting its reads would make the fixture depend
   * on how many referrals happen to be pending.
   */
  function companySequence(...rows: Record<string, unknown>[]): StubEndpoint {
    let index = 0;
    return endpoint("GET", /\/rest\/v1\/companies/, (call) => {
      if (!(call.url.searchParams.get("select") ?? "").startsWith("id,plan")) {
        return [{ stripe_subscription_id: "sub_1" }];
      }
      return [rows[Math.min(index++, rows.length - 1)]];
    });
  }

  it("swaps the PLAN licensed item to the pause price, and nothing else", async () => {
    const harness = makeHarness([
      // Unpaused going in, paused coming out. POST /pause answers from a
      // RE-READ, so a row frozen at "unpaused" is a fixture asserting that the
      // swap never took — which is the replay case, not this one.
      companySequence(activeUnpaused(), activePaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          moduleItems: [
            { id: "si_module", priceId: env.STRIPE_MODULE_VOICE_PRICE_ID! },
          ],
        }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! }),
      ),
      pausePriceEndpoint(),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(200);

    const form = harness.callsTo("POST", /subscriptions\/sub_1/)[0].form();
    // The PLAN item, by id — not "the first unmetered item", which on this
    // subscription is the Calling module and would have been silently
    // converted into a pause.
    expect(form.get("items[0][id]")).toBe("si_licensed");
    expect(form.get("items[0][price]")).toBe(env.STRIPE_PAUSE_PRICE_ID);
    expect(form.get("items[1][id]")).toBeNull();
    // Fair to the part-month, and quiet: a credit note landing in the inbox of
    // somebody who just chose to spend less is a support ticket, not a receipt.
    expect(form.get("proration_behavior")).toBe("create_prorations");
  });

  it("409s when the pause price is not provisioned — never a free pause", async () => {
    // The failure this prevents is not an error: it is a workspace holding a
    // number and a live 10DLC campaign, ~$3/mo between them, against no
    // revenue, because somebody deployed before provisioning the price.
    const bare = { ...env, STRIPE_PAUSE_PRICE_ID: undefined };
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
    ]);
    stubFetch(harness.route);
    const response = await makeApp("owner").request(
      "/v1/billing/pause",
      { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
      bare,
    );
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscriptions\/sub_1/)).toHaveLength(0);
  });

  /**
   * The stubs a resume needs, with the swap actually taking effect.
   *
   * The subscription reads PAUSED on the first retrieve and on the plan price
   * after that, because that is what the swap in between did. Everything the
   * route runs afterwards — the mirror, the referral payout — reads the
   * resumed shape, and a fixture frozen at "paused" would quietly make those
   * steps assert the wrong thing.
   */
  function resumeHarness(extra: StubEndpoint[] = []) {
    let retrieves = 0;
    return makeHarness([
      companySequence(activePaused(), activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        (retrieves += 1) === 1
          ? subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! })
          : subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      ...extra,
      ...afterSwapEndpoints(),
    ]);
  }

  it("resume swaps the PAUSE item back to the stored plan's price", async () => {
    // `companies.plan` was never touched — that is the payoff for the pause not
    // being a third plan_id, and it is where the resume price comes from.
    const harness = resumeHarness();
    const response = await post("/v1/billing/resume", {}, harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: "starter", paused_at: null });

    const form = harness.callsTo("POST", /subscriptions\/sub_1/)[0].form();
    expect(form.get("items[0][id]")).toBe("si_licensed");
    expect(form.get("items[0][price]")).toBe(env.STRIPE_STARTER_PRICE_ID);
  });

  it("keys the resume on THE PAUSE, so a same-day re-pause can be resumed again", async () => {
    // A day-scoped key made resume → pause → resume inside one day replay the
    // FIRST resume: Stripe returns the cached response, no swap happens, and the
    // customer is told they resumed while they stay paused and unable to send.
    // `paused_at` is stamped once per pause, so it names this pause exactly.
    const harness = resumeHarness();
    await post("/v1/billing/resume", {}, harness);
    const key = harness
      .callsTo("POST", /subscriptions\/sub_1/)[0]
      .headers.get("Idempotency-Key");
    expect(key).toContain("2026-11-04T00:00:00.000Z");
    expect(key).not.toContain(new Date().toISOString().slice(0, 10));
  });

  it("resume tells the customer what the MIRROR says, not a constant", async () => {
    // The route used to answer `{ paused_at: null }` unconditionally. That is a
    // sentence that stays true-looking when everything behind it has failed, and
    // the customer acts on it — they go and try to send.
    const harness = makeHarness([
      // The mirror does not clear: the workspace is still paused after the swap.
      companySequence(activePaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/resume", {}, harness);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message)
      .toMatch(/hasn't come back/i);
    // And no audit entry claiming a resume that did not happen.
    expect(harness.callsTo("POST", /\/rest\/v1\/audit_log/)).toHaveLength(0);
  });

  it("resume is not left CHARGED AND BLOCKED when the mirror write fails", async () => {
    // syncSubscription throws on any PostgREST error, and by then
    // `create_prorations` has already billed the balance of the period back up
    // to the plan price. A bare throw meant a 500, a full-price bill, and five
    // SQL send gates still refusing every text — with no way out, because
    // /resume itself 409s once the subscription carries no pause item.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let mirrorAttempts = 0;
    const harness = makeHarness([
      companySequence(activePaused(), activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => {
        mirrorAttempts += 1;
        // The canonical mirror fails; the narrow fallback that follows it is
        // what has to land.
        return mirrorAttempts === 1
          ? new Response(JSON.stringify({ message: "deadlock detected" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            })
          : [{ id: COMPANY_ID }];
      }),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => [{ id: "a1" }]),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      endpoint("GET", /\/rest\/v1\/referrals/, () => []),
    ]);
    const response = await post("/v1/billing/resume", {}, harness);
    expect(response.status).toBe(200);
    expect(mirrorAttempts).toBe(2);
    const fallback = harness.callsTo("PATCH", /\/rest\/v1\/companies/)[1].json();
    expect(fallback).toEqual({ paused_at: null, paused_price_cents: null });
    spy.mockRestore();
  });

  it("resume pays a referral month that qualified while the workspace was paused", async () => {
    // `rewardSide` refuses to spend a $29/$79 credit on a ~$5 holding fee and
    // leaves the row unstamped. Nothing in this product sweeps unstamped
    // rewards, so without this the month is lost just as surely as if it had
    // been spent on the hold.
    const harness = resumeHarness([
      endpoint("GET", /\/rest\/v1\/referrals/, () => [{ id: "ref-1" }]),
      endpoint("POST", /\/rest\/v1\/rpc\/stamp_referral_reward/, () => ({
        outcome: "stamped",
      })),
    ]);
    const response = await post("/v1/billing/resume", {}, harness);
    expect(response.status).toBe(200);

    // The coupon lands on the RESUMED plan line — the whole point of waiting.
    const rewardWrite = harness.callsTo("POST", /subscriptions\/sub_1/)[1].form();
    expect(rewardWrite.get("items[0][discounts][0][coupon]")).toBe(
      env.STRIPE_REFERRAL_MONTH_COUPON_ID,
    );
    expect(
      harness.callsTo("POST", /rpc\/stamp_referral_reward/)[0].json(),
    ).toMatchObject({ p_side: "referrer" });
  });

  it("409s on resume when nothing is paused", async () => {
    const harness = makeHarness([companyEndpoint(activeUnpaused())]);
    const response = await post("/v1/billing/resume", {}, harness);
    expect(response.status).toBe(409);
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("GET reports eligibility in cents and never leaks a price id", async () => {
    // A price id in a client bundle is a value somebody can put in a checkout
    // call. Same boundary GET /v1/billing/prepay already draws.
    const harness = makeHarness([
      companyEndpoint(activePaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! }),
      ),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    ]);
    const response = await get("/v1/billing/pause", harness);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      eligible: false,
      reason: "already_paused",
      paused_at: "2026-11-04T00:00:00.000Z",
      monthly_cents: 500,
      resume_plan: "starter",
    });
    expect(JSON.stringify(body)).not.toContain(env.STRIPE_PAUSE_PRICE_ID);
  });

  /**
   * A Stripe price, as the catalog answers a retrieve. `unit_amount` is the
   * monthly figure a client renders; `cents` in the route's response must be
   * this and nothing else.
   */
  function pausePriceEndpoint(
    overrides: Record<string, unknown> = {},
  ): StubEndpoint {
    return endpoint("GET", /api\.stripe\.com\/v1\/prices\//, () => ({
      id: env.STRIPE_PAUSE_PRICE_ID,
      object: "price",
      active: true,
      unit_amount: 700,
      currency: "usd",
      recurring: { interval: "month", interval_count: 1 },
      ...overrides,
    }));
  }

  it("prices the FIRST pause from the catalog, because the mirror is empty", async () => {
    // THE defect this closes. `companies.paused_price_cents` is written from
    // the subscription item at pause time, so it is null for everybody who has
    // never paused — which is everybody the offer is shown to. Reporting it
    // meant every first-time pause asked somebody to agree to a recurring
    // charge whose amount we refused to state.
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint(),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    ]);
    const response = await get("/v1/billing/pause", harness);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      eligible: true,
      reason: null,
      paused_at: null,
      monthly_cents: 700,
      resume_plan: "starter",
    });
    // Still cents only. The offer being priced must not be the thing that
    // finally puts a price id in a client bundle.
    expect(JSON.stringify(body)).not.toContain(env.STRIPE_PAUSE_PRICE_ID);
  });

  it("quotes today's price, not the fee from a pause that already ended", async () => {
    // The mirror survives a resume as the record of what that pause cost. A
    // workspace pausing a second winter is being offered TODAY's price, and
    // quoting the old one would be a different number from the one it is about
    // to be charged — the same defect in a smaller font.
    const harness = makeHarness([
      companyEndpoint(
        companyRow({
          plan: "starter",
          subscription_status: "active",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
          paused_at: null,
          paused_price_cents: 500,
        }),
      ),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint(),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    ]);
    const response = await get("/v1/billing/pause", harness);
    expect(await response.json()).toMatchObject({
      eligible: true,
      monthly_cents: 700,
    });
  });

  it("quotes nothing rather than a price that cannot be charged", async () => {
    // A $0 pause price is a genuinely free pause and an archived one cannot go
    // on a subscription at all. `pausePriceSnapshot` refuses both, and reading
    // the quote through it is what stops this route advertising a pause that
    // POST would then decline.
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint({ unit_amount: 0 }),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    ]);
    const response = await get("/v1/billing/pause", harness);
    expect(response.status).toBe(200);
    // AND the offer is withdrawn, not merely left unpriced. `eligible` is what
    // puts the Pause button on the screen; reporting it true beside a null
    // amount is the priced-blind state this whole route exists to end, and the
    // press behind it 409s.
    expect(await response.json()).toMatchObject({
      eligible: false,
      reason: "not_provisioned",
      monthly_cents: null,
    });
  });

  it("pause tells the customer what the MIRROR says, not that it succeeded", async () => {
    // The mirror image of the resume case, and reachable through the pause
    // route's own idempotency key. The key is DAY-scoped, and nothing on the
    // subscription distinguishes a retried pause from a second one: after a
    // resume the licensed item is back on the same id at the same plan price,
    // so pause → resume → pause inside one day sends Stripe a byte-identical
    // request under a key it has already answered. Stripe returns the cached
    // response, no swap happens, and every step after it still succeeds.
    //
    // The row is what knows. Answering 200 here told somebody who pressed Pause
    // that they had paused, while they went on paying the full plan price and
    // sending at full quota.
    const harness = makeHarness([
      // The swap never landed, so the mirror never says paused.
      companySequence(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint(),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message)
      .toMatch(/hasn't paused yet/i);
    // And no audit entry claiming a pause that did not happen.
    expect(harness.callsTo("POST", /\/rest\/v1\/audit_log/)).toHaveLength(0);
  });

  it("pause is not left SWAPPED BUT UNBLOCKED when the mirror write fails", async () => {
    // The mirror direction that leaks money rather than trapping a customer.
    // The swap has landed, so Stripe is billing the ~$5 holding fee — and a
    // `paused_at` that never got written leaves the workspace texting at full
    // plan quota on it, with every SQL send gate waving it through.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let mirrorAttempts = 0;
    const harness = makeHarness([
      companySequence(activeUnpaused(), activePaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ licensed: env.STRIPE_PAUSE_PRICE_ID! }),
      ),
      pausePriceEndpoint(),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => {
        mirrorAttempts += 1;
        return mirrorAttempts === 1
          ? new Response(JSON.stringify({ message: "deadlock detected" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            })
          : [{ id: COMPANY_ID }];
      }),
      endpoint("POST", /\/rest\/v1\/audit_log/, () => [{ id: "a1" }]),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(200);
    expect(mirrorAttempts).toBe(2);
    // The fee comes from the price we actually swapped onto, not from a
    // constant — this column is what the #85 projection values the tenant at.
    const fallback = harness.callsTo("PATCH", /\/rest\/v1\/companies/)[1].json();
    expect(fallback).toEqual({
      paused_at: expect.any(String),
      paused_price_cents: 700,
    });
    spy.mockRestore();
  });

  it("REFUSES TO PAUSE onto a $0 price, which every other guard passes", async () => {
    // The env var is set, the id resolves, the swap would succeed and the
    // subscription would stay active. Nothing else in this feature can tell a
    // $0 pause price from a real one — and the workspace would hold a number and
    // a live 10DLC campaign, ~$3/mo of ours, against no revenue at all. The
    // price is provisioned by hand in a dashboard; nothing prevents the typo.
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint({ unit_amount: 0 }),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscriptions\/sub_1/)).toHaveLength(0);
  });

  it("REFUSES TO PAUSE onto a TIERED price, which would re-value the tenant", async () => {
    // A tiered price has no `unit_amount`, so `paused_price_cents` mirrors NULL
    // and the #85 projection falls back to the plan's list price — the founder's
    // underwater report would render the paused cohort as its most profitable
    // customers. That column exists to prevent exactly that.
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint({ unit_amount: null, billing_scheme: "tiered" }),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /subscriptions\/sub_1/)).toHaveLength(0);
  });

  it("REFUSES TO PAUSE while an unspent referral month rides the licensed item", async () => {
    // #399's free month is a 100%-off coupon on the same line a pause swaps.
    // Earn one, pause before the next invoice, and the pause bills $0 while we
    // pay for the held number and the live campaign — and the customer burns a
    // $29/$79 credit on a ~$5 charge.
    const withMonth = subscriptionFixture();
    (withMonth.items.data[0] as Record<string, unknown>).discounts = [
      { id: "di_1", coupon: { id: env.STRIPE_REFERRAL_MONTH_COUPON_ID } },
    ];
    const harness = makeHarness([
      companyEndpoint(activeUnpaused()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () => withMonth),
      pausePriceEndpoint(),
      ...afterSwapEndpoints(),
    ]);
    const response = await post("/v1/billing/pause", {}, harness);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message)
      .toMatch(/free month/i);
    expect(harness.callsTo("POST", /subscriptions\/sub_1/)).toHaveLength(0);
  });

  it("quotes nothing when there is no offer — an unhealthy subscription", async () => {
    // Not an oversight: a workspace that cannot pause is not being asked to
    // agree to anything, so there is no amount it needs stated.
    const harness = makeHarness([
      companyEndpoint(
        companyRow({
          plan: "starter",
          subscription_status: "past_due",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
        }),
      ),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      pausePriceEndpoint(),
      endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    ]);
    const response = await get("/v1/billing/pause", harness);
    expect(await response.json()).toMatchObject({
      eligible: false,
      reason: "subscription_unhealthy",
      monthly_cents: null,
    });
  });
});
