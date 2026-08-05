/**
 * #277 — POST /v1/billing/modules against a PAUSED workspace.
 *
 * ITS OWN FILE, BECAUSE THE PROPERTY CANNOT BE REACHED THROUGH THE REAL
 * CATALOG. There is exactly one module today (`regions_ca`) and #41 holds it
 * unsellable, so every request to this route is refused at the availability
 * check — above the pause gate, above Stripe, above any money. A suite written
 * against the live catalog would therefore pass just as green with the pause
 * gate deleted, which is the shape of guard this round exists to stop shipping.
 * So `isSellableModule` is mocked to yes: exactly the state the product enters
 * the day multi-region provisioning ships or a second module joins the catalog,
 * and the only state in which this route can charge anybody at all.
 *
 * The mock is file-wide, which is why this is not in `billing.test.ts` — a
 * sibling there asserts the opposite (regions_ca refused as unsellable, #41)
 * and must keep asserting it against the real function.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../billing/company-modules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../billing/company-modules")>();
  // Only the #41 deliverability answer is swapped. Everything else —
  // `enabledModules`, the #17 reconcile — stays the real implementation.
  return { ...actual, isSellableModule: () => true };
});

import { billingRoutes } from "./billing";
import type { AppEnv, MemberRole } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import { endpoint, makeHarness, type Harness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const PAUSED_AT = "2026-11-04T00:00:00.000Z";
const CA_PRICE = env.STRIPE_MODULE_REGIONS_CA_PRICE_ID!;

function makeApp(role: MemberRole = "owner"): Hono<AppEnv> {
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

async function toggle(
  body: { module: string; enabled: boolean },
  harness: Harness,
  bindings: Record<string, unknown> = env,
): Promise<Response> {
  stubFetch(harness.route);
  return makeApp().request(
    "/v1/billing/modules",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    bindings,
  );
}

/**
 * A live Starter workspace. `paused` is the ONLY thing that varies between the
 * refusal and the purchase below — subscription_status stays 'active' and plan
 * stays 'starter' either way, because that is precisely what a pause looks
 * like from here (a licensed-PRICE swap leaves both untouched).
 */
function companyRow(paused: boolean) {
  return {
    id: COMPANY_ID,
    plan: "starter",
    country: "US",
    us_texting_enabled: true,
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    registration_fee_paid_at: null,
    billing_currency: null,
    paused_at: paused ? PAUSED_AT : null,
    paused_price_cents: paused ? 500 : null,
  };
}

/** The subscription, optionally already carrying the module's line item. */
function subscription(withModuleItem = false) {
  return {
    id: "sub_1",
    object: "subscription",
    status: "active",
    schedule: null,
    items: {
      object: "list",
      data: [
        {
          id: "si_licensed",
          object: "subscription_item",
          quantity: 1,
          price: {
            id: env.STRIPE_STARTER_PRICE_ID,
            object: "price",
            recurring: { interval: "month" },
          },
        },
        ...(withModuleItem
          ? [
              {
                id: "si_ca",
                object: "subscription_item",
                quantity: 1,
                price: { id: CA_PRICE, object: "price", recurring: { interval: "month" } },
              },
            ]
          : []),
      ],
    },
  };
}

function harnessFor(paused: boolean, withModuleItem = false): Harness {
  return makeHarness([
    endpoint("GET", /\/rest\/v1\/companies/, () => [companyRow(paused)]),
    endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
      subscription(withModuleItem),
    ),
    endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
      id: "si_ca",
      object: "subscription_item",
    })),
    endpoint("DELETE", /api\.stripe\.com\/v1\/subscription_items\/si_ca/, () => ({
      id: "si_ca",
      object: "subscription_item",
      deleted: true,
    })),
    endpoint("POST", /\/rest\/v1\/company_modules/, () => []),
    endpoint("PATCH", /\/rest\/v1\/company_modules/, () => []),
    endpoint("POST", /\/rest\/v1\/audit_log/, () => [{ id: "a1" }]),
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#277 POST /v1/billing/modules — a paused workspace does not buy add-ons", () => {
  it("MP-1: enabling on a paused workspace is a 409 that never reaches Stripe", async () => {
    // The charge this refuses is immediate and full-price: the enable path
    // creates the line item with `always_invoice`, so the owner would be billed
    // today for a capability the pause has switched off, on top of the holding
    // fee they are paying to be switched off.
    const harness = harnessFor(true);
    const response = await toggle({ module: "regions_ca", enabled: true }, harness);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toMatch(/paused/i);
    expect(body.error.message).toMatch(/resume/i);
    // Named, so the sentence is about the thing they pressed.
    expect(body.error.message).toContain("Canada numbers");
    // Nothing was created and nothing was even read at Stripe: no half-done
    // purchase to unwind, and no item to reconcile away.
    expect(harness.callsTo("POST", /api\.stripe\.com/)).toHaveLength(0);
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("MP-2: the SAME request buys the module when the workspace is not paused", async () => {
    /**
     * The other half of MP-1, and the reason MP-1 means anything. This route
     * has four refusals above the pause gate; without this case a 409 from any
     * of them would read as the pause gate working. Everything here is byte
     * identical to MP-1 except `paused_at`.
     */
    const harness = harnessFor(false);
    const response = await toggle({ module: "regions_ca", enabled: true }, harness);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ module: "regions_ca", enabled: true });
    const created = harness.callsTo("POST", /api\.stripe\.com\/v1\/subscription_items$/);
    expect(created).toHaveLength(1);
    expect(created[0].form().get("price")).toBe(CA_PRICE);
    // The charge MP-1 exists to prevent, in the state where it is legitimate.
    expect(created[0].form().get("proration_behavior")).toBe("always_invoice");
  });

  it("MP-3: a paused workspace may still turn a module OFF", async () => {
    /**
     * The asymmetry is deliberate. A module's line item bills straight through
     * a pause — the swap touches the plan's licensed item and nothing else — so
     * a disable is the customer STOPPING a charge for something they cannot
     * use. A gate on both directions would answer "resume your plan, at full
     * price, if you want to stop paying for this".
     */
    const harness = harnessFor(true, true);
    const response = await toggle({ module: "regions_ca", enabled: false }, harness);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ module: "regions_ca", enabled: false });
    expect(
      harness.callsTo("DELETE", /api\.stripe\.com\/v1\/subscription_items\/si_ca/),
    ).toHaveLength(1);
  });

  it("MP-4: an unbuyable module is refused as unbuyable, not sent away to resume", async () => {
    /**
     * Ordering, and it is worth real money. With the pause gate first, a
     * workspace asking for a module this environment cannot sell — no
     * provisioned price, which is the ordinary state of a module the day it
     * joins the catalog — would be told to resume, pay a full plan month, and
     * come back to a 422 that was always going to be there.
     */
    const unprovisioned = { ...env, STRIPE_MODULE_REGIONS_CA_PRICE_ID: undefined };
    const harness = harnessFor(true);
    const response = await toggle(
      { module: "regions_ca", enabled: true },
      harness,
      unprovisioned,
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toContain("isn't available yet");
    expect(body.error.message).not.toMatch(/resume/i);
  });

  it("MP-5: the route ASKS the database for paused_at", async () => {
    /**
     * The gate reads a column, and the harness answers every select with the
     * whole fixture row — so dropping `paused_at` from `fetchCompany`'s select
     * would keep MP-1 green here while PostgREST returned `undefined` in
     * production, where undefined is falsy and every pause gate in this file
     * silently opens. Same guard, same reason, as numbers.test.ts NP-5.
     */
    const harness = harnessFor(true);
    await toggle({ module: "regions_ca", enabled: true }, harness);

    const reads = harness.callsTo("GET", /\/rest\/v1\/companies/);
    expect(reads).toHaveLength(1);
    expect(reads[0].url.searchParams.get("select")).toContain("paused_at");
  });
});
