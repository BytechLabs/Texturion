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
  overrides: {
    id?: string;
    status?: string;
    /** #277: the licensed price on the item a pause swaps. */
    licensed?: string;
    /** What that price bills, in its base currency — the pause fee mirror. */
    licensedUnitAmount?: number | null;
  } = {},
) {
  const {
    id = "sub_1",
    status = "active",
    licensed = env.STRIPE_STARTER_PRICE_ID,
    licensedUnitAmount = null,
  } = overrides;
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
            id: licensed,
            object: "price",
            recurring: { interval: "month" },
            unit_amount: licensedUnitAmount,
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
      // #134: the mirror attaches the missing per-plan voice metered item to
      // every live subscription (calling is included on every plan).
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
        id: "si_voice_metered",
        object: "subscription_item",
      })),
      // #134: the mirror also voice-binds the live workspace's numbers — no
      // numbers here, quiet no-op.
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary).toEqual({
      reconciled: 1,
      staleInvites: 0,
      orphanSubscriptionsCancelled: 0,
      orphanSubscriptionsFlagged: 0,
      retiredModuleItemsRemoved: 0,
      extraNumberQuantitiesConverged: 0,
      // #523: nothing on hold — the ordinary state.
      numbersHeldOverAllowance: 0,
      workspacesHoldingNumbers: 0,
    });
    // #12: the re-mirror scan excludes terminal canceled tenants (which keep
    // their sub id forever → unbounded churn growth) and is bounded per run.
    const remirrorCall = harness.callsTo("GET", /\/rest\/v1\/companies/)[0];
    expect(
      remirrorCall.url.searchParams.getAll("subscription_status"),
    ).toContain("neq.canceled");
    expect(remirrorCall.url.searchParams.get("limit")).toBe("500");
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
    // #134/D42: the missing voice metered item converged onto the plan's price.
    const attach = harness.callsTo("POST", /subscription_items$/);
    expect(attach).toHaveLength(1);
    expect(attach[0].form().get("subscription")).toBe("sub_1");
    expect(attach[0].form().get("price")).toBe(
      env.STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID,
    );
    expect(attach[0].form().has("quantity")).toBe(false);
  });

  it("re-mirrors an ACTIVE company whose billing period already ended", async () => {
    // The period columns are written only by a live renewal webhook, and the
    // webhook sweeper abandons a row after five attempts, so an outage across a
    // renewal pins the period to last month with nothing to correct it. Every
    // billing read is anchored on it: the send cap then sums two months of
    // usage against one month's ceiling and starts refusing a crew that is well
    // inside its plan.
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/companies/, (call) => {
        if (call.url.searchParams.has("stripe_customer_id")) return [];
        // The stale-period scan is the one filtering on current_period_end.
        return call.url.searchParams.has("current_period_end")
          ? [{ id: COMPANY_ID, stripe_subscription_id: "sub_1" }]
          : [];
      }),
      endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(0)),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "active" }),
      ),
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
        id: "si_voice_metered",
        object: "subscription_item",
      })),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.reconciled).toBe(1);
    const scan = harness
      .callsTo("GET", /\/rest\/v1\/companies/)
      .find((call) => call.url.searchParams.has("current_period_end"));
    // Bounded by the FAULT, not by status: only a period that already ended.
    expect(scan?.url.searchParams.get("subscription_status")).toBe("eq.active");
    expect(
      scan?.url.searchParams.getAll("current_period_end") ?? [],
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^lt\./)]));
    // Stripe's current truth was written back.
    expect(harness.callsTo("PATCH", /\/rest\/v1\/companies/)).toHaveLength(1);
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
      retiredModuleItemsRemoved: 0,
      extraNumberQuantitiesConverged: 0,
      // #523: nothing on hold — the ordinary state.
      numbersHeldOverAllowance: 0,
      workspacesHoldingNumbers: 0,
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
      // #134: past_due is live — the mirror attaches the voice metered item
      // and voice-binds the numbers on the healthy tenant too.
      endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
        id: "si_voice_metered",
        object: "subscription_item",
      })),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
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

describe("retired-module item sweep (#103 — strip the stale $5 mms item)", () => {
  const CUSTOMER = "cus_1";
  const STORED = "sub_stored";
  const nowEpoch = Math.floor(NOW.getTime() / 1000);

  const sweepCompany = {
    id: COMPANY_ID,
    stripe_customer_id: CUSTOMER,
    stripe_subscription_id: STORED,
  };
  /** A stored subscription whose items carry the given price ids. */
  function storedWithItems(...priceIds: string[]) {
    return {
      id: STORED,
      object: "subscription",
      status: "active",
      created: nowEpoch - 7200,
      cancel_at_period_end: false,
      items: {
        object: "list",
        has_more: false,
        data: priceIds.map((priceId, i) => ({
          id: `si_${i}`,
          object: "subscription_item",
          price: { id: priceId, object: "price" },
        })),
      },
    };
  }
  const listEndpoint = (body: unknown) =>
    endpoint("GET", /\/v1\/subscriptions\?customer=/, () => ({
      object: "list",
      url: "/v1/subscriptions",
      has_more: false,
      data: [body],
    }));

  it("deletes the mms AND voice items with a prorated credit and derived idempotency keys (#134: voice is retired too)", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(
        storedWithItems(
          env.STRIPE_STARTER_PRICE_ID,
          env.STRIPE_MODULE_MMS_PRICE_ID as string,
          // #134/D42: the $8 licensed voice item is retired — swept with
          // credit exactly like mms/extra_storage.
          env.STRIPE_MODULE_VOICE_PRICE_ID as string,
          env.STRIPE_MODULE_REGIONS_CA_PRICE_ID as string, // live module — untouched
        ),
      ),
      endpoint("DELETE", /\/v1\/subscription_items\/si_[12]/, (call) => ({
        id: call.url.pathname.split("/").pop(),
        object: "subscription_item",
        deleted: true,
      })),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.retiredModuleItemsRemoved).toBe(2);
    const dels = harness.callsTo("DELETE", /\/v1\/subscription_items/);
    expect(dels).toHaveLength(2);
    expect(dels.map((d) => d.url.pathname).sort()).toEqual([
      "/v1/subscription_items/si_1",
      "/v1/subscription_items/si_2",
    ]);
    // The unused remainder is credited back — never keep the customer's money
    // for a module that no longer exists. (stripe-node encodes DELETE params
    // into the query string.)
    for (const del of dels) {
      expect(del.url.searchParams.get("proration_behavior")).toBe(
        "create_prorations",
      );
    }
    // Date-scoped: yesterday's cached Stripe FAILURE can never replay as
    // today's result — each daily sweep is a fresh attempt.
    expect(dels[0].headers.get("Idempotency-Key")).toBe(
      `${COMPANY_ID}:retired_item:si_1:2026-07-01`,
    );
  });

  it("a schedule-managed subscription strips the price from every phase instead of deleting the item (#18)", async () => {
    // A pending downgrade pins items into schedule phases; Stripe rejects a
    // direct item delete AND the pinned phases would re-apply the $5 item at
    // rollover. The sweep must go through the schedule, like the module toggle.
    // Phase boundaries use the REAL clock: applyPriceToSchedulePhases filters
    // completed phases by Date.now(), not the job's injected `now`.
    const NOW_EPOCH = Math.floor(Date.now() / 1000);
    const scheduleUpdates: unknown[] = [];
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint({
        ...storedWithItems(
          env.STRIPE_STARTER_PRICE_ID,
          env.STRIPE_MODULE_MMS_PRICE_ID as string,
        ),
        schedule: "sub_sched_1",
      }),
      endpoint(
        "GET",
        /\/v1\/subscription_schedules\/sub_sched_1/,
        () => ({
          id: "sub_sched_1",
          object: "subscription_schedule",
          phases: [
            {
              start_date: NOW_EPOCH - 86_400,
              end_date: NOW_EPOCH + 86_400,
              items: [
                { price: env.STRIPE_STARTER_PRICE_ID, quantity: 1 },
                { price: env.STRIPE_MODULE_MMS_PRICE_ID, quantity: 1 },
              ],
            },
            {
              start_date: NOW_EPOCH + 86_400,
              end_date: NOW_EPOCH + 30 * 86_400,
              items: [
                { price: env.STRIPE_STARTER_PRICE_ID, quantity: 1 },
                { price: env.STRIPE_MODULE_MMS_PRICE_ID, quantity: 1 },
              ],
            },
          ],
        }),
      ),
      endpoint("POST", /\/v1\/subscription_schedules\/sub_sched_1/, (call) => {
        scheduleUpdates.push(call.form());
        return { id: "sub_sched_1", object: "subscription_schedule" };
      }),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.retiredModuleItemsRemoved).toBe(1);
    // The item was NEVER deleted directly (Stripe would reject it)…
    expect(harness.callsTo("DELETE", /\/v1\/subscription_items/)).toHaveLength(0);
    // …the schedule phases were rebuilt WITHOUT the retired price, with the
    // credit riding the next invoice.
    expect(scheduleUpdates).toHaveLength(1);
    const form = scheduleUpdates[0] as URLSearchParams;
    expect(form.get("proration_behavior")).toBe("create_prorations");
    const flat = form.toString();
    expect(flat).toContain(encodeURIComponent(env.STRIPE_STARTER_PRICE_ID));
    expect(flat).not.toContain(
      encodeURIComponent(env.STRIPE_MODULE_MMS_PRICE_ID as string),
    );
  });

  it("no retired items on the subscription: deletes nothing", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(
        storedWithItems(
          env.STRIPE_STARTER_PRICE_ID,
          // #134: regions_ca is the one live module left in the catalog.
          env.STRIPE_MODULE_REGIONS_CA_PRICE_ID as string,
        ),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.retiredModuleItemsRemoved).toBe(0);
    expect(harness.callsTo("DELETE", /\/v1\/subscription_items/)).toHaveLength(0);
  });

  it("the mms price was never provisioned (env unset): the sweep is a no-op", async () => {
    const bare = { ...env, STRIPE_MODULE_MMS_PRICE_ID: undefined };
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      // The item still carries the old price id, but without the env var we
      // cannot know it is ours — never delete on a guess.
      listEndpoint(
        storedWithItems(env.STRIPE_STARTER_PRICE_ID, "price_module_mms_0001"),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(bare, NOW);
    expect(summary.retiredModuleItemsRemoved).toBe(0);
    expect(harness.callsTo("DELETE", /\/v1\/subscription_items/)).toHaveLength(0);
  });

  it("an already-deleted item (lost race) is treated as done, not an error", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(
        storedWithItems(
          env.STRIPE_STARTER_PRICE_ID,
          env.STRIPE_MODULE_MMS_PRICE_ID as string,
        ),
      ),
      endpoint("DELETE", /\/v1\/subscription_items\/si_1/, () =>
        new Response(
          JSON.stringify({
            error: { code: "resource_missing", message: "No such item" },
          }),
          { status: 404 },
        ),
      ),
    ]);
    stubFetch(harness.route);

    // The run succeeds; nothing counted, nothing flagged as removed.
    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.retiredModuleItemsRemoved).toBe(0);
  });

  it("a thrown item delete does NOT redden the run (retried next sweep)", async () => {
    const harness = makeHarness([
      ...baseEndpoints([], 0, [sweepCompany]),
      listEndpoint(
        storedWithItems(
          env.STRIPE_STARTER_PRICE_ID,
          env.STRIPE_MODULE_MMS_PRICE_ID as string,
        ),
      ),
      endpoint("DELETE", /\/v1\/subscription_items\/si_1/, () =>
        new Response(
          JSON.stringify({ error: { message: "delete failed" } }),
          { status: 500 },
        ),
      ),
    ]);
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);
    expect(summary.retiredModuleItemsRemoved).toBe(0);
  });
});

/**
 * #277 — the daily sweep and a paused workspace.
 *
 * A pause leaves `subscription_status` 'active' and `plan` populated, so a
 * paused tenant sails into every scan this job runs. The extra-number
 * convergence is the one that must not act on it: its formula reads
 * `PLAN_LIMITS[plan].numbers`, and during a pause `plan` names the plan the
 * workspace will RESUME onto rather than the one it is paying for. There is no
 * "included numbers" figure for a pause price to converge against.
 */
describe("extra-number convergence skips a paused workspace (#277)", () => {
  const CUSTOMER = "cus_1";
  const STORED = "sub_stored";

  function sweepWorld(pausedAt: string | null) {
    return makeHarness([
      endpoint("GET", /\/rest\/v1\/companies/, (call) => {
        // #110's raise fence, which the convergence reads before it retrieves
        // the subscription. Answered so the unpaused case gets all the way
        // through; the paused case must never reach it.
        if (call.url.searchParams.get("select")?.includes("paid_capacity_epoch")) {
          return [{ paid_capacity_epoch: 0 }];
        }
        return call.url.searchParams.has("stripe_customer_id")
          ? [
              {
                id: COMPANY_ID,
                plan: "starter",
                paused_at: pausedAt,
                stripe_customer_id: CUSTOMER,
                stripe_subscription_id: STORED,
              },
            ]
          : [];
      }),
      endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(0)),
      endpoint("GET", /\/v1\/subscriptions\?customer=/, () => ({
        object: "list",
        url: "/v1/subscriptions",
        has_more: false,
        data: [
          {
            id: STORED,
            object: "subscription",
            status: "active",
            created: Math.floor(NOW.getTime() / 1000) - 7200,
            cancel_at_period_end: false,
            items: { object: "list", data: [] },
          },
        ],
      })),
      // Convergence's OWN first Stripe read (#110: it always retrieves the
      // subscription fresh, after the raise-fence epoch). Distinct from the
      // customer LIST above, so a call here means exactly "the convergence ran".
      endpoint("GET", /\/v1\/subscriptions\/sub_stored/, () => ({
        id: STORED,
        object: "subscription",
        status: "active",
        schedule: null,
        items: { object: "list", data: [] },
      })),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(0)),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
    ]);
  }

  it("never converges a paused workspace's extra numbers", async () => {
    const harness = sweepWorld("2026-11-04T00:00:00.000Z");
    stubFetch(harness.route);

    const summary = await runSubscriptionReconcileJob(env, NOW);

    expect(summary.extraNumberQuantitiesConverged).toBe(0);
    expect(harness.callsTo("GET", /\/v1\/subscriptions\/sub_stored/)).toHaveLength(0);
  });

  it("DOES converge an unpaused workspace — the guard above is real", async () => {
    // PROVE THE GUARD BY BREAKING IT: the same world with the pause lifted must
    // reach the convergence, or the assertion above would pass against a sweep
    // that never converges anything.
    const harness = sweepWorld(null);
    stubFetch(harness.route);

    await runSubscriptionReconcileJob(env, NOW);

    expect(
      harness.callsTo("GET", /\/v1\/subscriptions\/sub_stored/).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * #277 — the pause fact converges within a day, which is what three comments in
 * this codebase promise a reader.
 *
 * `companies.paused_at` is a SEND GATE. Every consumer of it leans on the same
 * promise: getSendGates and routes/calls.ts both coalesce a missing value to
 * "not paused" — deliberately, because a wrong "paused" would refuse a paying
 * crew's texts and calls — and both justify that by saying the next mirror pass
 * writes the fact back. Nothing made that true. A pause leaves the subscription
 * genuinely active with a fresh period, so a paused workspace was in neither
 * re-mirror scan and no job re-read it in either direction.
 *
 * Two scans close it, and each is tested here in the direction the other cannot
 * see:
 *   - the paused re-mirror scan, for a workspace we KNOW is paused (a resume
 *     that landed at Stripe and not here — POST /resume charges first and then
 *     mirrors, and there is no self-serve way back from that throw);
 *   - the orphan sweep's item read, for a workspace we do NOT know is paused.
 */
describe("the pause fact converges daily (#277)", () => {
  const CUSTOMER = "cus_1";
  const STORED = "sub_stored";
  const PAUSED_AT = "2026-11-04T00:00:00.000Z";

  /** Every companies PATCH body a run produced. */
  function patchBodies(harness: ReturnType<typeof makeHarness>) {
    return harness
      .callsTo("PATCH", /\/rest\/v1\/companies/)
      .map((call) => call.json() as Record<string, unknown>);
  }

  /**
   * #110's raise-fence read — the first thing convergeExtraNumberQuantity does,
   * and therefore the cheapest proof of whether #105's extra-number convergence
   * ran for a tenant.
   */
  function raiseFenceReads(harness: ReturnType<typeof makeHarness>) {
    return harness
      .callsTo("GET", /\/rest\/v1\/companies/)
      .filter((call) =>
        call.url.searchParams.get("select")?.includes("paid_capacity_epoch"),
      );
  }

  describe("the paused re-mirror scan", () => {
    /**
     * A world where the ONLY company the scans can find is one this database
     * marks paused: the non-active scan and the stale-period scan both answer
     * empty, so a Stripe call at all proves the third scan ran.
     */
    function pausedScanWorld(stored: {
      paused_at: string | null;
      paused_price_cents: number | null;
    }) {
      return makeHarness([
        endpoint("GET", /\/rest\/v1\/companies/, (call) => {
          if (call.url.searchParams.has("stripe_customer_id")) return []; // sweep off
          return call.url.searchParams.has("paused_at")
            ? [{ id: COMPANY_ID, stripe_subscription_id: "sub_1" }]
            : [];
        }),
        endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(0)),
        // Stripe's truth: the plan price is back on the licensed item. The
        // customer has been charged for the resume; only our mirror is behind.
        endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
          subscriptionFixture({ status: "active" }),
        ),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => [
          {
            id: COMPANY_ID,
            name: "Acme Plumbing",
            canceled_at: null,
            company_modules: [],
            ...stored,
          },
        ]),
        endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
          id: "si_voice_metered",
          object: "subscription_item",
        })),
        endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      ]);
    }

    it("re-mirrors a paused workspace, so a resume that never landed heals", async () => {
      const harness = pausedScanWorld({
        paused_at: PAUSED_AT,
        paused_price_cents: 500,
      });
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(env, NOW);

      expect(summary.reconciled).toBe(1);
      // The scan is the paused one — not a widening of the others.
      const scan = harness
        .callsTo("GET", /\/rest\/v1\/companies/)
        .find((call) => call.url.searchParams.has("paused_at"));
      expect(scan?.url.searchParams.get("subscription_status")).toBe("eq.active");
      expect(scan?.url.searchParams.get("paused_at")).toBe("not.is.null");
      expect(scan?.url.searchParams.get("limit")).toBe("500");
      // And the workspace is out: the send gate is lifted and the margin
      // report stops valuing it at the holding fee.
      expect(patchBodies(harness)).toContainEqual({
        paused_at: null,
        paused_price_cents: null,
      });
    });

    it("leaves an ordinary active workspace alone — the scan is bounded", async () => {
      // PROVE THE GUARD BY BREAKING IT, the other way round: if the scan were
      // widened to every active company it would still pass the test above
      // while re-mirroring the entire paying base daily. Nothing here is
      // paused, so nothing may be fetched.
      const harness = makeHarness([
        endpoint("GET", /\/rest\/v1\/companies/, () => []),
        endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(0)),
      ]);
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(env, NOW);

      expect(summary.reconciled).toBe(0);
      expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
    });
  });

  describe("the orphan sweep's licensed-item read", () => {
    /**
     * The sweep world: one settled tenant whose stored subscription carries
     * `licensed`, and a mirror that currently says `stored`. The sweep already
     * lists this subscription for the orphan check, so reading its licensed
     * item costs nothing.
     */
    function sweepWorld(
      licensed: string,
      licensedUnitAmount: number | null,
      stored: { paused_at: string | null; paused_price_cents: number | null },
    ) {
      const subscription = {
        ...subscriptionFixture({ id: STORED, licensed, licensedUnitAmount }),
        created: Math.floor(NOW.getTime() / 1000) - 7200,
        cancel_at_period_end: false,
        schedule: null,
      };
      return makeHarness([
        endpoint("GET", /\/rest\/v1\/companies/, (call) => {
          if (call.url.searchParams.get("select")?.includes("paid_capacity_epoch")) {
            return [{ paid_capacity_epoch: 0 }];
          }
          return call.url.searchParams.has("stripe_customer_id")
            ? [
                {
                  id: COMPANY_ID,
                  plan: "starter",
                  stripe_customer_id: CUSTOMER,
                  stripe_subscription_id: STORED,
                  ...stored,
                },
              ]
            : [];
        }),
        endpoint("HEAD", /\/rest\/v1\/invites/, () => countResponse(0)),
        endpoint("GET", /\/v1\/subscriptions\?customer=/, () => ({
          object: "list",
          url: "/v1/subscriptions",
          has_more: false,
          data: [subscription],
        })),
        // syncSubscription's own re-fetch, and the extra-number convergence's.
        endpoint("GET", /\/v1\/subscriptions\/sub_stored/, () => subscription),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => [
          {
            id: COMPANY_ID,
            name: "Acme Plumbing",
            canceled_at: null,
            company_modules: [],
            ...stored,
          },
        ]),
        endpoint("POST", /api\.stripe\.com\/v1\/subscription_items$/, () => ({
          id: "si_voice_metered",
          object: "subscription_item",
        })),
        endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(0)),
        endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      ]);
    }

    it("writes back a pause the mirror never saw", async () => {
      // The direction the paused scan cannot reach: Stripe carries the pause
      // price, our mirror says the workspace is running — so every gate in the
      // product is currently letting a holding-fee tenant text and dial.
      const harness = sweepWorld("price_pause_0001", 500, {
        paused_at: null,
        paused_price_cents: null,
      });
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(env, NOW);

      expect(summary.reconciled).toBe(1);
      const bodies = patchBodies(harness);
      expect(bodies.some((b) => typeof b.paused_at === "string")).toBe(true);
      expect(bodies.some((b) => b.paused_price_cents === 500)).toBe(true);
      // And #105's extra-number convergence stayed away. Its skip reads the
      // subscription's own licensed item now, not the mirror — this sweep
      // exists for the case where the mirror is the stale thing, and converging
      // a paused workspace onto PLAN_LIMITS[plan].numbers is exactly what #277
      // decided must never happen. The raise-fence read is its first move.
      expect(raiseFenceReads(harness)).toHaveLength(0);
    });

    it("converges a repriced pause, so the margin report values it right", async () => {
      // The fee is founder-provisioned in the Stripe dashboard and can change
      // under a live pause; #85 reads this column to decide who is underwater.
      const harness = sweepWorld("price_pause_0001", 500, {
        paused_at: PAUSED_AT,
        paused_price_cents: 300,
      });
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(env, NOW);

      expect(summary.reconciled).toBe(1);
      const bodies = patchBodies(harness);
      expect(bodies.some((b) => b.paused_price_cents === 500)).toBe(true);
      // The DATE is not walked forward — "paused since 4 November" is shown to
      // the customer and this job runs every day.
      expect(bodies.some((b) => "paused_at" in b)).toBe(false);
    });

    it("an agreeing mirror costs nothing — the check above is real", async () => {
      // PROVE THE GUARD BY BREAKING IT: an unconditional re-mirror would pass
      // both tests above while re-writing every swept tenant daily. Stripe and
      // the mirror agree here, so there must be no re-mirror at all.
      const harness = sweepWorld(env.STRIPE_STARTER_PRICE_ID, 2900, {
        paused_at: null,
        paused_price_cents: null,
      });
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(env, NOW);

      expect(summary.reconciled).toBe(0);
      expect(
        patchBodies(harness).some((b) => "paused_at" in b),
      ).toBe(false);
      // …and the extra-number convergence DID run here, which is what makes the
      // "stayed away" assertion above mean something: the skip is decided by
      // the licensed item, not switched off for every swept tenant.
      expect(raiseFenceReads(harness).length).toBeGreaterThan(0);
    });

    it("says nothing when it recognises neither price — the un-provisioned deploy", async () => {
      // The un-provisioned deploy, which is where a two-answer reading gives
      // the product away: with STRIPE_PAUSE_PRICE_ID missing, every paused
      // subscription stops matching, and a sweep that read that as "not
      // paused" would clear the gate on the whole paused cohort, on a cron.
      const bare = { ...env, STRIPE_PAUSE_PRICE_ID: undefined };
      const harness = sweepWorld("price_pause_0001", 500, {
        paused_at: PAUSED_AT,
        paused_price_cents: 500,
      });
      stubFetch(harness.route);

      const summary = await runSubscriptionReconcileJob(bare, NOW);

      expect(summary.reconciled).toBe(0);
      expect(patchBodies(harness).some((b) => "paused_at" in b)).toBe(false);
    });
  });
});
