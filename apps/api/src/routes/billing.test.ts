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

function checkoutSessionEndpoint(): StubEndpoint {
  return endpoint("POST", /api\.stripe\.com\/v1\/checkout\/sessions$/, () => ({
    id: "cs_1",
    url: "https://checkout.stripe.com/c/pay/cs_1",
  }));
}

function subscriptionFixture(
  overrides: { licensed?: string; metered?: string; schedule?: string | null } = {},
) {
  const {
    licensed = env.STRIPE_STARTER_PRICE_ID,
    metered = env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    schedule = null,
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

  it("US company with no registration rows → 409", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow()),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
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

  it("CA company with us_texting_enabled=true owes the same draft gate", async () => {
    const harness = makeHarness([
      companyEndpoint(companyRow({ country: "CA", us_texting_enabled: true })),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
    ]);
    const response = await post(
      "/v1/billing/checkout",
      { plan: "starter" },
      harness,
    );
    expect(response.status).toBe(409);
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
    expect(form.get("line_items[0][price]")).toBe(env.STRIPE_STARTER_PRICE_ID);
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[1][price]")).toBe(
      env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    );
    // Metered items must NOT carry a quantity (SPEC §9).
    expect(form.has("line_items[1][quantity]")).toBe(false);
    expect(form.get("line_items[2][price]")).toBe(env.STRIPE_US_FEE_PRICE_ID);
    expect(form.get("line_items[2][quantity]")).toBe("1");
    expect(form.get("success_url")).toBe(
      `${env.APP_ORIGIN}/onboarding/setting-up?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(form.get("cancel_url")).toBe(
      `${env.APP_ORIGIN}/onboarding/plan?checkout=canceled`,
    );
    expect(form.has("customer")).toBe(false);
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
    expect(form.has("line_items[2][price]")).toBe(false);
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
    expect(form.has("line_items[2][price]")).toBe(false);
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
    expect(form.has("line_items[2][price]")).toBe(false);
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
    });
    const form = harness.callsTo("POST", /billing_portal/)[0].form();
    expect(form.get("customer")).toBe("cus_1");
    expect(form.get("return_url")).toBe(`${env.APP_ORIGIN}/settings/billing`);
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

  it("upgrade swaps both items to Pro with always_invoice proration, immediately", async () => {
    const harness = makeHarness([
      companyEndpoint(activeStarter()),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        proSubscription(),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    const response = await post(
      "/v1/billing/change-plan",
      { plan: "pro" },
      harness,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: "pro", effective: "now" });

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
