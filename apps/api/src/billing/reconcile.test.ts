/**
 * Daily subscription-reconcile job suite (SPEC §11): non-active companies are
 * re-fetched from Stripe and re-mirrored through the same syncSubscription
 * path the §9 webhook handlers use (convergent backstop for missed webhooks);
 * stale pending invites are counted, never mutated. Real product code
 * (stripe-node over fetch, supabase-js PostgREST) with only global fetch
 * stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSubscriptionReconcileJob } from "./reconcile";
import {
  countResponse,
  endpoint,
  makeHarness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = new Date("2026-07-01T15:00:00.000Z");
const PERIOD_START = 1_750_000_000;
const PERIOD_END = 1_752_600_000;

function subscriptionFixture(
  overrides: { id?: string; status?: string } = {},
) {
  const { id = "sub_1", status = "active" } = overrides;
  return {
    id,
    object: "subscription",
    status,
    items: {
      object: "list",
      data: [
        {
          id: "si_licensed",
          object: "subscription_item",
          quantity: 1,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: {
            id: env.STRIPE_STARTER_PRICE_ID,
            object: "price",
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
}

function baseEndpoints(
  companies: { id: string; stripe_subscription_id: string }[],
  staleInvites = 0,
): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, () => companies),
    endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(staleInvites)),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSubscriptionReconcileJob (SPEC §11 subscription reconcile)", () => {
  it("re-fetches each non-active company's subscription and re-mirrors the truth", async () => {
    const patches: unknown[] = [];
    const harness = makeHarness([
      ...baseEndpoints([
        { id: COMPANY_ID, stripe_subscription_id: "sub_1" },
      ]),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "active" }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, (call) => {
        patches.push(call.json());
        return [{ id: COMPANY_ID, name: "Acme Plumbing" }];
      }),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary).toEqual({ reconciled: 1, staleInvites: 0 });
    // The mirror wrote Stripe's CURRENT truth (missed-webhook backstop).
    expect(patches).toEqual([
      {
        subscription_status: "active",
        current_period_start: new Date(PERIOD_START * 1000).toISOString(),
        current_period_end: new Date(PERIOD_END * 1000).toISOString(),
        cancel_at_period_end: false,
        plan: "starter",
      },
    ]);
    // The update targeted the row by its subscription id.
    const patch = harness.callsTo("PATCH", /\/rest\/v1\/companies/)[0];
    expect(patch.url.searchParams.get("stripe_subscription_id")).toBe(
      "eq.sub_1",
    );
  });

  it("no non-active companies: never calls Stripe, still reports stale invites", async () => {
    const harness = makeHarness(baseEndpoints([], 3));
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary).toEqual({ reconciled: 0, staleInvites: 3 });
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
    // Report only — no invite row was mutated (§11: acceptance already checks).
    expect(
      harness.calls.filter(
        (call) => call.method !== "GET" && call.method !== "HEAD",
      ),
    ).toHaveLength(0);
  });

  it("one broken tenant does not starve the rest; the run still fails loudly", async () => {
    const OTHER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
    const harness = makeHarness([
      ...baseEndpoints([
        { id: COMPANY_ID, stripe_subscription_id: "sub_broken" },
        { id: OTHER_ID, stripe_subscription_id: "sub_2" },
      ]),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/subscriptions\/sub_broken/,
        () =>
          new Response(
            JSON.stringify({ error: { message: "no such subscription" } }),
            { status: 500 },
          ),
      ),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_2/, () =>
        subscriptionFixture({ id: "sub_2", status: "past_due" }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: OTHER_ID, name: "Fine Co" },
      ]),
    ]);
    stubFetch(harness.route);

    await expect(runSubscriptionReconcileJob(env, NOW)).rejects.toThrow(
      /failed for 1 company/,
    );
    // The healthy tenant was still re-mirrored (to Stripe's past_due truth).
    const patch = harness.callsTo("PATCH", /\/rest\/v1\/companies/)[0];
    expect(patch.url.searchParams.get("stripe_subscription_id")).toBe(
      "eq.sub_2",
    );
    expect((patch.json() as { subscription_status: string }).subscription_status).toBe(
      "past_due",
    );
  });
});
