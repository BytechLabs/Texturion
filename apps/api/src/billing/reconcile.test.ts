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
  // The orphan sweep's companies query (distinguished by its stripe_customer_id
  // filter). Default empty → the sweep is a no-op for the re-mirror tests.
  sweepCompanies: unknown[] = [],
): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, (call) =>
      call.url.searchParams.has("stripe_customer_id") ? sweepCompanies : companies,
    ),
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
    expect(summary).toEqual({
      reconciled: 1,
      staleInvites: 0,
      orphanSubscriptionsCancelled: 0,
      orphanSubscriptionsFlagged: 0,
    });
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
    expect(summary).toEqual({
      reconciled: 0,
      staleInvites: 3,
      orphanSubscriptionsCancelled: 0,
      orphanSubscriptionsFlagged: 0,
    });
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

describe("orphan-subscription sweep (§11 double-buy safety net)", () => {
  const CUSTOMER = "cus_1";
  const STORED = "sub_stored";
  const nowEpoch = Math.floor(NOW.getTime() / 1000);
  const OLD = nowEpoch - 7200; // 2h old (past the 60-min floor)
  const YOUNG = nowEpoch - 600; // 10 min old (inside the webhook-race window)

  const sweepCompany = {
    id: COMPANY_ID,
    stripe_customer_id: CUSTOMER,
    stripe_subscription_id: STORED,
  };
  function sub(
    id: string,
    status: string,
    overrides: { created?: number; cancel_at_period_end?: boolean } = {},
  ) {
    return {
      id,
      object: "subscription",
      status,
      created: overrides.created ?? OLD,
      cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    };
  }
  const subList = (...data: unknown[]) => ({
    object: "list",
    url: "/v1/subscriptions",
    has_more: false,
    data,
  });
  /** GET /v1/subscriptions?customer=… (the list, not the retrieve-by-id). */
  const listEndpoint = (body: unknown) =>
    endpoint("GET", /\/v1\/subscriptions\?customer=/, () => body);

  it("cancels a settled company's extra live subscription with a derived idempotency key", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(subList(sub(STORED, "active"), sub("sub_orphan", "active"))),
      endpoint("DELETE", /\/v1\/subscriptions\/sub_orphan/, () =>
        sub("sub_orphan", "canceled"),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.orphanSubscriptionsCancelled).toBe(1);
    expect(summary.orphanSubscriptionsFlagged).toBe(0);
    const cancel = harness.callsTo("DELETE", /\/v1\/subscriptions\/sub_orphan/);
    expect(cancel).toHaveLength(1);
    expect(cancel[0].headers.get("Idempotency-Key")).toBe(
      `${COMPANY_ID}:orphan_cancel:sub_orphan`,
    );
  });

  it("FLAGS but never cancels when the stored subscription is not confirmed live", async () => {
    // The missed-activation case: the DB points at a canceled sub, so the live
    // non-stored sub may be the customer's ONLY one — page a human, don't kill it.
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(subList(sub(STORED, "canceled"), sub("sub_other", "active"))),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.orphanSubscriptionsCancelled).toBe(0);
    expect(summary.orphanSubscriptionsFlagged).toBe(1);
    expect(harness.callsTo("DELETE", /\/v1\/subscriptions/)).toHaveLength(0);
  });

  it("honors the age / cancel_at_period_end / status guards", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(
        subList(
          sub(STORED, "active"),
          sub("sub_young", "active", { created: YOUNG }), // < 60 min → skip
          sub("sub_winddown", "active", { cancel_at_period_end: true }), // skip
          sub("sub_trial", "trialing"), // not collectible → skip
          sub("sub_incomplete", "incomplete"), // not collectible → skip
        ),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.orphanSubscriptionsCancelled).toBe(0);
    expect(summary.orphanSubscriptionsFlagged).toBe(0);
    expect(harness.callsTo("DELETE", /\/v1\/subscriptions/)).toHaveLength(0);
  });

  it("cancels a past_due orphan (collectible), not just active", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(subList(sub(STORED, "active"), sub("sub_pastdue", "past_due"))),
      endpoint("DELETE", /\/v1\/subscriptions\/sub_pastdue/, () =>
        sub("sub_pastdue", "canceled"),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.orphanSubscriptionsCancelled).toBe(1);
  });

  it("a thrown cancel is flagged and does NOT redden the run", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(subList(sub(STORED, "active"), sub("sub_orphan", "active"))),
      endpoint("DELETE", /\/v1\/subscriptions\/sub_orphan/, () =>
        new Response(
          JSON.stringify({ error: { message: "cancel failed" } }),
          { status: 500 },
        ),
      ),
    ]);
    stubFetch(harness.route);

    // The run STILL succeeds (a stuck cancel is retried next sweep, not fatal).
    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.orphanSubscriptionsCancelled).toBe(0);
    expect(summary.orphanSubscriptionsFlagged).toBe(1);
  });

  it("a thrown subscriptions.list reddens the run without starving siblings", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      endpoint("GET", /\/v1\/subscriptions\?customer=/, () =>
        new Response(
          JSON.stringify({ error: { message: "list failed" } }),
          { status: 500 },
        ),
      ),
    ]);
    stubFetch(harness.route);

    await expect(runSubscriptionReconcileJob(env, NOW)).rejects.toThrow(
      /failed for 1 company/,
    );
  });

  it("skips a customer with >100 subscriptions (partial view), cancels nothing", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      endpoint("GET", /\/v1\/subscriptions\?customer=/, () => ({
        object: "list",
        url: "/v1/subscriptions",
        has_more: true,
        data: [sub(STORED, "active"), sub("sub_orphan", "active")],
      })),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.orphanSubscriptionsCancelled).toBe(0);
    expect(harness.callsTo("DELETE", /\/v1\/subscriptions/)).toHaveLength(0);
  });
});
