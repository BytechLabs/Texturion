/**
 * #522 — the prepaid year at the route, in the money the workspace is billed in.
 *
 * The sharpest instance of the issue was a false price before a real charge: the
 * offer's own card quoted "$290" to a Canadian workspace, and this product
 * prints CAD as the bare "$" ON PURPOSE, because the reader is Canadian. The
 * card was then charged US$290 — because a ONE-TIME Stripe price with no option
 * for the session's currency does not refuse the session, it silently bills its
 * base currency. Nothing failed. Nobody was told.
 *
 * These are route tests rather than unit tests because the contract three
 * clients build against is the JSON, and the money that actually moves is the
 * form body Stripe receives.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { billingRoutes } from "./billing";
import { resetCheckoutCurrencyCache } from "../billing/checkout-currency";
import type { AppEnv } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import { endpoint, makeHarness, type StubEndpoint } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const YEAR_PRICE = env.STRIPE_STARTER_YEAR_PRICE_ID as string;

function makeApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", USER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("memberId", MEMBER_ID);
    c.set("role", "owner");
    await next();
  });
  app.route("/v1/billing", billingRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    throw error;
  });
  return app;
}

/**
 * A Canadian workspace, active, activated, with a healthy subscription — every
 * gate in prepayEligibility passing except the one under test.
 */
function canadianCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPANY_ID,
    plan: "starter",
    country: "CA",
    us_texting_enabled: false,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    registration_fee_paid_at: null,
    billing_currency: "cad",
    paused_at: null,
    paused_price_cents: null,
    ...overrides,
  };
}

/**
 * Everything the prepay routes touch, with the year price's catalog state as
 * the single variable.
 *
 * `cadFiled` is the operator action this whole probe exists for: filing a
 * currency against a live price is `stripe:setup`, not a deploy, so the code
 * cannot assume it has happened.
 */
function endpoints(
  options: { cadFiled: boolean; company?: Record<string, unknown> } = {
    cadFiled: true,
  },
): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, () => [
      options.company ?? canadianCompany(),
    ]),
    // The activation probe: this workspace has sent something.
    endpoint("GET", /\/rest\/v1\/messages/, () => [{ id: "m1" }]),
    endpoint("POST", /\/rest\/v1\/rpc\/open_prepayment/, () => null),
    endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () => ({
      id: "sub_1",
      object: "subscription",
      status: "active",
      schedule: null,
      items: { object: "list", data: [] },
    })),
    endpoint("GET", new RegExp(`api\\.stripe\\.com/v1/prices/${YEAR_PRICE}`), () => ({
      id: YEAR_PRICE,
      object: "price",
      currency: "usd",
      unit_amount: 29_000,
      currency_options: options.cadFiled
        ? { cad: { unit_amount: 39_000 } }
        : {},
    })),
    endpoint("POST", /api\.stripe\.com\/v1\/checkout\/sessions$/, () => ({
      id: "cs_prepay_1",
      url: "https://checkout.stripe.com/c/pay/cs_prepay_1",
    })),
  ];
}

describe("#522 GET /v1/billing/prepay", () => {
  beforeEach(() => {
    // The catalog probe memoises per price id for the isolate's lifetime, so
    // one test's Stripe account would otherwise answer the next one's question.
    resetCheckoutCurrencyCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("quotes a Canadian workspace in Canadian dollars", async () => {
    const harness = makeHarness(endpoints({ cadFiled: true }));
    stubFetch(harness.route);

    const response = await makeApp().request("/v1/billing/prepay", {}, env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.eligible).toBe(true);
    // Every figure in the response, and the name of the money they are in.
    // 39_000 and 3_900 are different numbers from each other and from anything
    // the USD side produces, so no single hardcode satisfies both.
    expect(body.currency).toBe("cad");
    expect(body.price_cents).toBe(39_000);
    expect(body.monthly_cents).toBe(3_900);
  });

  /**
   * THE ONE THAT MATTERS. The live state on the day this was filed: a CAD
   * workspace and a USD-only year price. The old answer was "eligible, 29000",
   * which a Canadian card paid as US$290.
   */
  it("offers nothing at all when the catalog cannot charge that currency", async () => {
    const harness = makeHarness(endpoints({ cadFiled: false }));
    stubFetch(harness.route);

    const response = await makeApp().request("/v1/billing/prepay", {}, env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("currency_unavailable");
    // Not the USD figure, and not a CAD figure we cannot collect. A surface
    // handed `price_cents` would render the offer with the wrong money on it,
    // greyed out or not.
    expect(body.price_cents).toBeNull();
    expect(body.currency).toBe("cad");
  });

  it("leaves a US workspace exactly as it was", async () => {
    const harness = makeHarness(
      endpoints({
        cadFiled: false,
        company: canadianCompany({ country: "US", billing_currency: "usd" }),
      }),
    );
    stubFetch(harness.route);

    const response = await makeApp().request("/v1/billing/prepay", {}, env);
    const body = (await response.json()) as Record<string, unknown>;

    // Unaffected by the catalog's CAD state, and never paying for the probe:
    // USD is every price's base currency and needs no read.
    expect(body).toMatchObject({
      eligible: true,
      currency: "usd",
      price_cents: 29_000,
      monthly_cents: 2_900,
    });
    expect(
      harness.callsTo("GET", new RegExp(`/v1/prices/${YEAR_PRICE}`)),
    ).toHaveLength(0);
  });
});

describe("#522 POST /v1/billing/prepay", () => {
  beforeEach(() => {
    resetCheckoutCurrencyCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the Checkout Session in the workspace's own currency", async () => {
    const harness = makeHarness(endpoints({ cadFiled: true }));
    stubFetch(harness.route);

    const response = await makeApp().request(
      "/v1/billing/prepay",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    const [session] = harness.callsTo(
      "POST",
      /api\.stripe\.com\/v1\/checkout\/sessions$/,
    );
    // The omission that WAS the defect. Without this field Stripe bills the
    // price's base currency and reports success either way, so only the request
    // body can prove it.
    expect(session.form().get("currency")).toBe("cad");
  });

  it("refuses rather than collecting US dollars against a CAD quote", async () => {
    const harness = makeHarness(endpoints({ cadFiled: false }));
    stubFetch(harness.route);

    const response = await makeApp().request(
      "/v1/billing/prepay",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(409);
    // No session at all: the money never starts moving.
    expect(
      harness.callsTo("POST", /api\.stripe\.com\/v1\/checkout\/sessions$/),
    ).toHaveLength(0);
  });
});
