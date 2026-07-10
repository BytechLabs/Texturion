/**
 * Stripe webhook suite (D13 dedicated suites: signature verification + the §9
 * subscription state machine). Real product code end to end — the Hono route,
 * constructEventAsync over the RAW body, supabase-js PostgREST, stripe-node
 * re-fetches — with only global fetch stubbed. Signatures are REAL: payloads
 * are signed with the stripe library itself and verified by the route.
 *
 * The telnyx contract functions (provisionCompanyNumber, ...) resolve to typed
 * test doubles via the vitest alias (see vitest.config.ts) because that track
 * lands in a parallel worktree.
 */
import { Hono } from "hono";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stripeWebhookRoute } from "./stripe";
import { POSTHOG_CAPTURE_URL } from "../analytics/posthog";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import {
  endpoint,
  makeExecutionContext,
  makeHarness,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { sendPortEmail, startPortSaga } from "../test/telnyx-doubles/porting";
import {
  provisionCompanyNumber,
  suspendCompanyNumbers,
} from "../test/telnyx-doubles/provisioning";
import { submitRegistration } from "../test/telnyx-doubles/registration";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PERIOD_START = 1_750_000_000;
const PERIOD_END = 1_752_592_000;
const EVENT_CREATED = 1_750_001_000;

const app = new Hono<AppEnv>();
app.route("/webhooks/stripe", stripeWebhookRoute);

// The signing side of the wire: the same library Stripe's servers agree with.
const signer = new Stripe("sk_test_signer_only");
function sign(payload: string): string {
  return signer.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
}

let eventCounter = 0;
function eventOf(
  type: string,
  object: unknown,
  overrides: { id?: string; created?: number } = {},
): { id: string; type: string } & Record<string, unknown> {
  eventCounter += 1;
  return {
    id: overrides.id ?? `evt_${eventCounter}`,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: overrides.created ?? EVENT_CREATED,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}

function subscriptionFixture(
  overrides: {
    id?: string;
    status?: string;
    licensed?: string;
    metered?: string;
    cancelAtPeriodEnd?: boolean;
    modulePriceIds?: string[];
    canceledAt?: number | null;
  } = {},
) {
  const {
    id = "sub_1",
    status = "active",
    licensed = env.STRIPE_STARTER_PRICE_ID,
    metered = env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    cancelAtPeriodEnd = false,
    modulePriceIds = [],
    canceledAt = null,
  } = overrides;
  return {
    id,
    object: "subscription",
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: canceledAt,
    schedule: null,
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
        ...modulePriceIds.map((priceId, i) => ({
          id: `si_module_${i}`,
          object: "subscription_item",
          quantity: 1,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: { id: priceId, object: "price", recurring: { interval: "month" } },
        })),
      ],
    },
  };
}

function checkoutSessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    object: "checkout.session",
    mode: "subscription",
    payment_status: "paid",
    client_reference_id: COMPANY_ID,
    subscription: "sub_1",
    customer: "cus_1",
    ...overrides,
  };
}

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    object: "invoice",
    metadata: {},
    hosted_invoice_url: "https://invoice.stripe.test/i/in_1",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_1", metadata: {} },
    },
    ...overrides,
  };
}

/**
 * The §9 checkout activation claim (claim_checkout_activation) — the
 * double-charge fail-safe that replaced the unconditional activation PATCH.
 * Defaults to 'claimed' with no existing modules (the fresh-checkout path);
 * a test prepends its own stub to exercise 'duplicate'. Non-checkout webhook
 * tests never call the RPC, so this is inert for them.
 */
function activationRpc(
  opts: {
    outcome?: "claimed" | "noop" | "duplicate";
    existingSub?: string | null;
    modules?: unknown[];
  } = {},
): StubEndpoint {
  return endpoint("POST", /\/rest\/v1\/rpc\/claim_checkout_activation/, () => ({
    outcome: opts.outcome ?? "claimed",
    existing_subscription_id: opts.existingSub ?? null,
    modules: opts.modules ?? [],
  }));
}

/** webhook_events ledger: dedupes on event_id like the real PK does. */
function ledgerEndpoints(seen = new Set<string>()): StubEndpoint[] {
  return [
    activationRpc(),
    endpoint("POST", /\/rest\/v1\/webhook_events/, (call) => {
      const row = call.json() as { event_id: string };
      if (seen.has(row.event_id)) return [];
      seen.add(row.event_id);
      return [{ event_id: row.event_id }];
    }),
    endpoint("GET", /\/rest\/v1\/webhook_events/, () => [{ attempts: 0 }]),
    endpoint("PATCH", /\/rest\/v1\/webhook_events/, () => new Response(null, { status: 204 })),
    // PORTING.md §4: the paid-checkout handler queries port_requests for any
    // pending port to drive (startPendingPorts). No pending ports in the
    // billing suites — the port saga has its own dedicated suite.
    endpoint("GET", /\/rest\/v1\/port_requests/, () => []),
    // #52 default: one-shot email claims succeed (fresh ledger). Tests that
    // need a conflict register their own endpoint BEFORE this one.
    endpoint("POST", /\/rest\/v1\/email_ledger/, (call) => [call.json()]),
  ];
}

function recipientEndpoints(): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/company_members/, () => [
      { user_id: "11111111-1111-4111-8111-111111111111" },
      { user_id: "22222222-2222-4222-8222-222222222222" },
    ]),
    endpoint("GET", /\/auth\/v1\/admin\/users\/1{4}/, () => ({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
    })),
    endpoint("GET", /\/auth\/v1\/admin\/users\/2{4}/, () => ({
      id: "22222222-2222-4222-8222-222222222222",
      email: "admin@example.com",
    })),
    endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
  ];
}

async function deliver(
  event: object,
  harness: Harness,
  options: { body?: string; header?: string | null; env?: Env } = {},
): Promise<Response> {
  const payload = options.body ?? JSON.stringify(event);
  const header =
    options.header === undefined ? sign(JSON.stringify(event)) : options.header;
  stubFetch(harness.route);
  const { ctx, drain } = makeExecutionContext();
  const response = await app.request(
    "/webhooks/stripe",
    {
      method: "POST",
      body: payload,
      headers: header === null ? {} : { "stripe-signature": header },
    },
    options.env ?? env,
    ctx,
  );
  await drain();
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signature verification (real signed payloads)", () => {
  const event = () => eventOf("customer.subscription.updated", subscriptionFixture());

  it("accepts a correctly signed payload and writes the ledger", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
    ]);
    const response = await deliver(event(), harness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(harness.callsTo("POST", /webhook_events/)).toHaveLength(1);
  });

  it("rejects a missing signature header with 400 and touches nothing", async () => {
    const harness = makeHarness([]);
    const response = await deliver(event(), harness, { header: null });
    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  it("rejects a signature minted with the wrong secret", async () => {
    const harness = makeHarness([]);
    const payload = JSON.stringify(event());
    const forged = new Stripe("sk_test_x").webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_someone_elses_secret",
    });
    const response = await deliver(event(), harness, { header: forged });
    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  it("rejects a tampered body (signature was for the original)", async () => {
    const harness = makeHarness([]);
    const original = event();
    const tampered = JSON.stringify({
      ...original,
      data: { object: subscriptionFixture({ status: "canceled" }) },
    });
    // Header signs the ORIGINAL payload; body arrives modified.
    const response = await deliver(original, harness, { body: tampered });
    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });
});

describe("replay: the webhook_events ledger makes redelivery a no-op", () => {
  it("processes a duplicated event id exactly once", async () => {
    const seen = new Set<string>();
    const buildHarness = () =>
      makeHarness([
        ...ledgerEndpoints(seen),
        endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
          subscriptionFixture(),
        ),
        endpoint(
          "GET",
          /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
          () => ({ object: "list", data: [] }),
        ),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
        endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
      ]);
    const event = eventOf("checkout.session.completed", checkoutSessionFixture(), {
      id: "evt_replayed",
    });

    // Each delivery gets a fresh harness; the shared `seen` set plays the PK.
    const firstHarness = buildHarness();
    const responseA = await deliver(event, firstHarness);
    expect(responseA.status).toBe(200);
    expect(await responseA.json()).toEqual({ received: true });

    const secondHarness = buildHarness();
    const responseB = await deliver(event, secondHarness);
    expect(responseB.status).toBe(200);
    expect(await responseB.json()).toEqual({ received: true, duplicate: true });

    // First delivery: ledger write + full processing (one activation claim).
    expect(
      firstHarness.callsTo("POST", /rpc\/claim_checkout_activation/),
    ).toHaveLength(1);
    expect(firstHarness.callsTo("GET", /subscriptions/)).toHaveLength(1);
    // Replay: the ONLY PostgREST traffic is the conflicting ledger insert.
    expect(secondHarness.callsTo("POST", /webhook_events/)).toHaveLength(1);
    expect(
      secondHarness.callsTo("POST", /rpc\/claim_checkout_activation/),
    ).toHaveLength(0);
    expect(secondHarness.callsTo("GET", /subscriptions/)).toHaveLength(0);
    expect(provisionCompanyNumber).toHaveBeenCalledTimes(1);
    expect(submitRegistration).toHaveBeenCalledTimes(1);
  });
});

describe("§9 event → state table", () => {
  it("checkout.session.completed (paid): activate, stamp ids + fee, un-suspend, provision, submit registration", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({
          object: "list",
          data: [
            { id: "li_1", price: { id: env.STRIPE_STARTER_PRICE_ID } },
            { id: "li_2", price: { id: env.STRIPE_US_FEE_PRICE_ID } },
          ],
        }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ]);
    const response = await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );
    expect(response.status).toBe(200);

    // Re-fetch-from-Stripe guard: the subscription was retrieved.
    expect(harness.callsTo("GET", /subscriptions\/sub_1/)).toHaveLength(1);

    // §9 double-charge fail-safe: activation is an ATOMIC claim (one live
    // subscription per company), not the old unconditional PATCH.
    const claims = harness.callsTo("POST", /rpc\/claim_checkout_activation/);
    expect(claims).toHaveLength(1);
    expect(claims[0].json()).toEqual({
      p_company_id: COMPANY_ID,
      p_customer_id: "cus_1",
      p_subscription_id: "sub_1",
      p_status: "active",
      p_plan: "starter",
      p_period_start: new Date(PERIOD_START * 1000).toISOString(),
      p_period_end: new Date(PERIOD_END * 1000).toISOString(),
      p_cancel_at_period_end: false,
    });

    // The ONLY companies PATCH now is the fee stamp (the claim owns activation).
    const companyPatches = harness.callsTo("PATCH", /companies/);
    expect(companyPatches).toHaveLength(1);
    // Fee stamp: gated on registration_fee_paid_at IS NULL (once ever, §2).
    const feeStamp = companyPatches[0];
    expect(feeStamp.url.searchParams.get("registration_fee_paid_at")).toBe("is.null");
    expect(feeStamp.json()).toEqual({
      registration_fee_paid_at: expect.any(String),
    });

    // Resubscribe-within-grace: suspended numbers get un-suspended.
    const unsuspend = harness.callsTo("PATCH", /phone_numbers/);
    expect(unsuspend).toHaveLength(1);
    expect(unsuspend[0].url.searchParams.get("status")).toBe("eq.suspended");
    expect(unsuspend[0].json()).toEqual({ status: "active", suspended_at: null });

    expect(provisionCompanyNumber).toHaveBeenCalledExactlyOnceWith(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_1",
    });
    // §4.1 step 5c / §9: the paid checkout submits the 10DLC registration
    // (R1, or the §4.4 post-grace campaign reactivation) — never manual.
    expect(submitRegistration).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
  });

  it("checkout.session.completed (DUPLICATE): cancels the orphan subscription and does NOT provision", async () => {
    // §9 double-charge fail-safe: a raced second checkout completes while a live
    // subscription already owns the company. The claim returns 'duplicate' → the
    // handler cancels THIS subscription (so it never bills) and skips provisioning.
    const harness = makeHarness([
      // Prepended so it wins the shared 'claimed' default.
      activationRpc({ outcome: "duplicate", existingSub: "sub_old" }),
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint("DELETE", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "canceled" }),
      ),
    ]);
    const response = await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );
    expect(response.status).toBe(200);

    // The duplicate subscription was cancelled…
    expect(harness.callsTo("DELETE", /subscriptions\/sub_1/)).toHaveLength(1);
    // …and NOTHING was provisioned or activated for it (no orphan number/fee).
    expect(provisionCompanyNumber).not.toHaveBeenCalled();
    expect(submitRegistration).not.toHaveBeenCalled();
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
    expect(harness.callsTo("GET", /checkout\/sessions\/cs_1\/line_items/)).toHaveLength(0);
  });

  it("checkout.session.completed enables the purchased plan-builder modules (#12)", async () => {
    const moduleUpserts: unknown[] = [];
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          modulePriceIds: [
            env.STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID!,
            env.STRIPE_MODULE_VOICE_PRICE_ID!,
          ],
        }),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({ object: "list", data: [] }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
      endpoint("POST", /\/rest\/v1\/company_modules/, (call) => {
        moduleUpserts.push(call.json());
        return [];
      }),
    ]);

    const response = await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );
    expect(response.status).toBe(200);

    // One upsert carrying both purchased modules, each enabled (disabled_at null).
    expect(moduleUpserts).toHaveLength(1);
    const rows = moduleUpserts[0] as {
      company_id: string;
      module: string;
      disabled_at: string | null;
    }[];
    expect(rows.map((r) => r.module).sort()).toEqual(["extra_storage", "voice"]);
    expect(rows.every((r) => r.company_id === COMPANY_ID)).toBe(true);
    expect(rows.every((r) => r.disabled_at === null)).toBe(true);
  });

  it("checkout.session.completed fires the checkout_completed PostHog event (§12 step 18)", async () => {
    const buildHarness = () =>
      makeHarness([
        ...ledgerEndpoints(),
        endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
          subscriptionFixture(),
        ),
        endpoint(
          "GET",
          /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
          () => ({
            object: "list",
            data: [{ id: "li_1", price: { id: env.STRIPE_STARTER_PRICE_ID } }],
          }),
        ),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
        endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
        endpoint("POST", /us\.i\.posthog\.com\/capture/, () => ({ status: 1 })),
      ]);

    // Key set → one capture, distinct_id = company_id, plan as safe metadata.
    const withKey = buildHarness();
    const response = await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      withKey,
      { env: { ...env, POSTHOG_API_KEY: "phc_test_key" } },
    );
    expect(response.status).toBe(200);
    const captures = withKey.callsTo("POST", /posthog/);
    expect(captures).toHaveLength(1);
    expect(captures[0].url.href).toBe(POSTHOG_CAPTURE_URL);
    expect(captures[0].json()).toEqual({
      api_key: "phc_test_key",
      event: "checkout_completed",
      distinct_id: COMPANY_ID,
      properties: { plan: "starter" },
    });

    // Key unset (every other suite's env) → zero PostHog traffic.
    const withoutKey = buildHarness();
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      withoutKey,
    );
    expect(withoutKey.callsTo("POST", /posthog/)).toHaveLength(0);
    expect(
      withoutKey.callsTo("POST", /rpc\/claim_checkout_activation/),
    ).toHaveLength(1);
  });

  it("checkout.session.completed without the fee line does not stamp the fee", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({
          object: "list",
          data: [{ id: "li_1", price: { id: env.STRIPE_STARTER_PRICE_ID } }],
        }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );
    // No fee line → no fee stamp; activation is the claim RPC, not a PATCH.
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
    expect(harness.callsTo("POST", /rpc\/claim_checkout_activation/)).toHaveLength(1);
  });

  it("checkout.session.completed guard: payment_status != 'paid' is a pure no-op", async () => {
    const harness = makeHarness([...ledgerEndpoints()]);
    const response = await deliver(
      eventOf(
        "checkout.session.completed",
        checkoutSessionFixture({ payment_status: "unpaid" }),
      ),
      harness,
    );
    expect(response.status).toBe(200);
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
    expect(provisionCompanyNumber).not.toHaveBeenCalled();
    expect(submitRegistration).not.toHaveBeenCalled();
    // ...but the ledger row was still stamped processed.
    expect(harness.callsTo("PATCH", /webhook_events/)).toHaveLength(1);
  });

  it("checkout.session.completed (no_payment_required / 100%-off coupon): provisions like paid", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({
          object: "list",
          data: [{ id: "li_1", price: { id: env.STRIPE_STARTER_PRICE_ID } }],
        }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ]);
    const response = await deliver(
      eventOf(
        "checkout.session.completed",
        checkoutSessionFixture({ payment_status: "no_payment_required" }),
      ),
      harness,
    );
    expect(response.status).toBe(200);
    // NOT a no-op: a comp'd $0 company activates + provisions exactly like paid.
    expect(harness.callsTo("GET", /subscriptions\/sub_1/)).toHaveLength(1);
    expect(
      harness.callsTo("POST", /rpc\/claim_checkout_activation/)[0].json(),
    ).toMatchObject({ p_status: "active" });
    expect(provisionCompanyNumber).toHaveBeenCalled();
  });

  it.each(["customer.subscription.created", "customer.subscription.updated"])(
    "%s mirrors the RE-FETCHED status, not the event payload's",
    async (type) => {
      // The event claims 'active'; Stripe's API — the truth — says 'past_due'.
      const harness = makeHarness([
        ...ledgerEndpoints(),
        endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
          subscriptionFixture({ status: "past_due" }),
        ),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => [
          { id: COMPANY_ID, name: "Acme Plumbing" },
        ]),
      ]);
      await deliver(
        eventOf(type, subscriptionFixture({ status: "active" })),
        harness,
      );

      expect(harness.callsTo("GET", /subscriptions\/sub_1/)).toHaveLength(1);
      const patches = harness.callsTo("PATCH", /companies/);
      expect(patches).toHaveLength(1);
      expect(patches[0].url.searchParams.get("stripe_subscription_id")).toBe(
        "eq.sub_1",
      );
      expect(patches[0].json()).toEqual({
        subscription_status: "past_due",
        plan: "starter",
        current_period_start: new Date(PERIOD_START * 1000).toISOString(),
        current_period_end: new Date(PERIOD_END * 1000).toISOString(),
        cancel_at_period_end: false,
      });
    },
  );

  it("customer.subscription.updated mirrors a pending period-end cancellation (SPEC §9 cancel_at_period_end display)", async () => {
    // Portal cancellation: Stripe keeps status 'active' but flags
    // cancel_at_period_end — the mirror must carry the flag (re-fetched
    // truth) so /settings/billing can announce "your plan ends on {date}".
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "active", cancelAtPeriodEnd: true }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
    ]);
    await deliver(
      // The event body still claims no pending cancellation; the re-fetch wins.
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );
    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(1);
    expect(patches[0].json()).toEqual({
      subscription_status: "active",
      plan: "starter",
      current_period_start: new Date(PERIOD_START * 1000).toISOString(),
      current_period_end: new Date(PERIOD_END * 1000).toISOString(),
      cancel_at_period_end: true,
    });
  });

  it("customer.subscription.updated syncs a plan change (upgrade rollover)", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          licensed: env.STRIPE_PRO_PRICE_ID,
          metered: env.STRIPE_PRO_OVERAGE_PRICE_ID,
        }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
    ]);
    await deliver(
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );
    expect(harness.callsTo("PATCH", /companies/)[0].json()).toMatchObject({
      plan: "pro",
      subscription_status: "active",
    });
  });

  it("customer.subscription.deleted: canceled + suspend + day-1 notice through the ledger", async () => {
    const graceInserts: unknown[] = [];
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
      endpoint("POST", /\/rest\/v1\/grace_notices/, (call) => {
        graceInserts.push(call.json());
        return [{ company_id: COMPANY_ID }];
      }),
      ...recipientEndpoints(),
    ]);
    await deliver(
      eventOf("customer.subscription.deleted", subscriptionFixture(), {
        created: EVENT_CREATED,
      }),
      harness,
    );

    const canceledAt = new Date(EVENT_CREATED * 1000).toISOString();
    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(2);
    expect(patches[0].json()).toEqual({
      subscription_status: "canceled",
      cancel_at_period_end: false,
    });
    // canceled_at is CLAIMED first-writer-wins (guarded on IS NULL) so a late
    // redelivery after the reconcile backstop converges on ONE ledger key.
    expect(patches[1].url.searchParams.get("canceled_at")).toBe("is.null");
    expect(patches[1].json()).toEqual({ canceled_at: canceledAt });
    expect(suspendCompanyNumbers).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    // Ledger row FIRST, keyed to the same canceled_at the company row got.
    expect(graceInserts).toEqual([
      { company_id: COMPANY_ID, canceled_at: canceledAt, threshold_day: 1 },
    ]);
    const emails = harness.callsTo("POST", /api\.resend\.com/);
    expect(emails).toHaveLength(1);
    expect(emails[0].json()).toMatchObject({
      from: env.RESEND_FROM,
      to: ["owner@example.com", "admin@example.com"],
    });
  });

  it("customer.subscription.deleted for a ledger-known cancellation does not re-email", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
      // Conflict: the §11 cron (or a prior delivery) already inserted day 1.
      endpoint("POST", /\/rest\/v1\/grace_notices/, () => []),
      ...recipientEndpoints(),
    ]);
    await deliver(
      eventOf("customer.subscription.deleted", subscriptionFixture()),
      harness,
    );
    expect(suspendCompanyNumbers).toHaveBeenCalledTimes(1);
    expect(harness.callsTo("POST", /api\.resend\.com/)).toHaveLength(0);
  });

  it("invoice.paid: re-fetch mirrors the subscription back to active", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "active" }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
    ]);
    await deliver(eventOf("invoice.paid", invoiceFixture()), harness);
    expect(harness.callsTo("GET", /subscriptions\/sub_1/)).toHaveLength(1);
    expect(harness.callsTo("PATCH", /companies/)[0].json()).toMatchObject({
      subscription_status: "active",
    });
    // A plain subscription invoice is not the enable-us branch.
    expect(submitRegistration).not.toHaveBeenCalled();
  });

  it("invoice.paid with us_registration metadata stamps the fee and submits (enable-us branch)", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf(
        "invoice.paid",
        invoiceFixture({
          metadata: { purpose: "us_registration", company_id: COMPANY_ID },
          parent: null, // one-off invoice — not subscription-linked
        }),
      ),
      harness,
    );
    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(1);
    expect(patches[0].url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
    expect(patches[0].url.searchParams.get("registration_fee_paid_at")).toBe(
      "is.null",
    );
    expect(patches[0].json()).toEqual({
      registration_fee_paid_at: expect.any(String),
    });
    // §9: "stamp registration_fee_paid_at and start the §4.4 submission
    // (R1)" — the paid enable-us invoice must trigger the submission itself.
    expect(submitRegistration).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    // No subscription on the invoice → no status mirror attempted.
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("invoice.payment_failed: → past_due (re-fetched) + dunning email", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({ status: "past_due" }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
      ...recipientEndpoints(),
    ]);
    await deliver(eventOf("invoice.payment_failed", invoiceFixture()), harness);

    expect(harness.callsTo("PATCH", /companies/)[0].json()).toMatchObject({
      subscription_status: "past_due",
    });
    const emails = harness.callsTo("POST", /api\.resend\.com/);
    expect(emails).toHaveLength(1);
    const email = emails[0].json() as { subject: string; text: string };
    expect(email.subject).toContain("payment failed");
    expect(email.text).toContain("https://invoice.stripe.test/i/in_1");
  });

  it("invoice.payment_failed with us_registration metadata clears the fee start-marker (retry unblocked, §2)", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf(
        "invoice.payment_failed",
        invoiceFixture({
          metadata: { purpose: "us_registration", company_id: COMPANY_ID },
          parent: null, // one-off fee invoice — not subscription-linked
        }),
      ),
      harness,
    );
    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(1);
    // Gated on registration_fee_paid_at IS NULL (a since-paid fee never reopens).
    expect(patches[0].url.searchParams.get("registration_fee_paid_at")).toBe(
      "is.null",
    );
    expect(patches[0].json()).toEqual({
      registration_fee_charge_started_at: null,
    });
    // No subscription on the fee invoice → no dunning email, no status mirror.
    expect(harness.callsTo("POST", /api\.resend\.com/)).toHaveLength(0);
    expect(harness.callsTo("GET", /api\.stripe\.com/)).toHaveLength(0);
  });

  it("invoice.payment_action_required: SCA email only, NO state change", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing" },
      ]),
      ...recipientEndpoints(),
    ]);
    await deliver(
      eventOf("invoice.payment_action_required", invoiceFixture()),
      harness,
    );
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
    const emails = harness.callsTo("POST", /api\.resend\.com/);
    expect(emails).toHaveLength(1);
    expect((emails[0].json() as { text: string }).text).toContain(
      "https://invoice.stripe.test/i/in_1",
    );
  });

  it("a processing failure records attempts + last_error for the sweeper cron", async () => {
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/subscriptions\/sub_1/,
        () =>
          new Response(JSON.stringify({ error: { message: "boom" } }), {
            status: 500,
          }),
      ),
    ]);
    const response = await deliver(
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );
    expect(response.status).toBe(200); // still acked — durability is the ledger's job
    const patches = harness.callsTo("PATCH", /webhook_events/);
    expect(patches).toHaveLength(1);
    expect(patches[0].json()).toMatchObject({
      attempts: 1,
      last_error: expect.any(String),
    });
  });
});

describe("module reconcile from the subscription's paid items (#17)", () => {
  const moduleRow = (
    module: string,
    overrides: Partial<{ disabled_at: string | null; grandfathered: boolean }> = {},
  ) => ({ module, disabled_at: null, grandfathered: false, ...overrides });

  /** Companies PATCH answering the activation with embedded module rows. */
  function companiesWithModules(rows: unknown[]): StubEndpoint {
    return endpoint("PATCH", /\/rest\/v1\/companies/, () => [
      { id: COMPANY_ID, name: "Acme Plumbing", canceled_at: null, company_modules: rows },
    ]);
  }

  it("checkout on a base-only resubscribe DISABLES stale modules and clears voice settings", async () => {
    // The #17 leak: enable extra_storage+voice, cancel, resubscribe base-only —
    // the stale rows used to stay enabled (free capability) forever.
    const harness = makeHarness([
      // The claim returns the stale modules (prepended so it wins the shared default).
      activationRpc({ modules: [moduleRow("extra_storage"), moduleRow("voice")] }),
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(), // base plan only — no module line items
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({ object: "list", data: [] }),
      ),
      // The voice-disable's forwarding clear is the only remaining companies PATCH.
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/company_modules/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );

    // Both unpaid modules disabled in one guarded update…
    const disables = harness.callsTo("PATCH", /\/rest\/v1\/company_modules/);
    expect(disables).toHaveLength(1);
    expect(disables[0].url.searchParams.get("module")).toBe(
      "in.(extra_storage,voice)",
    );
    expect(disables[0].url.searchParams.get("disabled_at")).toBe("is.null");
    expect(disables[0].json()).toEqual({ disabled_at: expect.any(String) });
    // …nothing re-enabled…
    expect(harness.callsTo("POST", /\/rest\/v1\/company_modules/)).toHaveLength(0);
    // …and the voice disable cleared forwarding exactly like the manual path
    // (the ONLY companies PATCH now the activation claim owns the write).
    const companyPatches = harness.callsTo("PATCH", /companies/);
    expect(companyPatches).toHaveLength(1);
    expect(companyPatches[0].json()).toEqual({
      forward_to_cell: null,
      mctb_enabled: false,
    });
  });

  it("grandfathered seed modules survive a base-only checkout untouched", async () => {
    const harness = makeHarness([
      // The claim returns the grandfathered rows (prepended to win the default).
      activationRpc({
        modules: [
          moduleRow("extra_storage", { grandfathered: true }),
          moduleRow("voice", { grandfathered: true }),
        ],
      }),
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({ object: "list", data: [] }),
      ),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );

    // No company_modules traffic at all, no voice clearing — and the event
    // fully processed (nothing threw on an unexpected write). Activation is the
    // claim RPC now, so there is NO companies PATCH.
    expect(
      harness.calls.filter((call) =>
        /\/rest\/v1\/company_modules/.test(call.url.href),
      ),
    ).toHaveLength(0);
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(0);
    expect(harness.callsTo("PATCH", /webhook_events/)[0].json()).toEqual({
      processed_at: expect.any(String),
    });
  });

  it("customer.subscription.updated converges enables AND disables onto the paid set", async () => {
    // Paid: extra_storage (currently disabled row). Unpaid: voice (enabled).
    const moduleUpserts: unknown[] = [];
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          modulePriceIds: [env.STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID!],
        }),
      ),
      companiesWithModules([
        moduleRow("extra_storage", { disabled_at: "2026-06-01T00:00:00.000Z" }),
        moduleRow("voice"),
      ]),
      endpoint("POST", /\/rest\/v1\/company_modules/, (call) => {
        moduleUpserts.push(call.json());
        return [];
      }),
      endpoint("PATCH", /\/rest\/v1\/company_modules/, () => new Response(null, { status: 204 })),
    ]);
    await deliver(
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );

    // extra_storage re-enabled with the grandfather flag cleared (paid now)…
    expect(moduleUpserts).toEqual([
      [
        {
          company_id: COMPANY_ID,
          module: "extra_storage",
          enabled_at: expect.any(String),
          disabled_at: null,
          grandfathered: false,
        },
      ],
    ]);
    // …voice disabled (no paid item), forwarding cleared.
    const disables = harness.callsTo("PATCH", /\/rest\/v1\/company_modules/);
    expect(disables).toHaveLength(1);
    expect(disables[0].url.searchParams.get("module")).toBe("in.(voice)");
    const companyPatches = harness.callsTo("PATCH", /companies/);
    expect(companyPatches[1].json()).toEqual({
      forward_to_cell: null,
      mctb_enabled: false,
    });
  });
});

describe("missed-cancellation backstop (#21)", () => {
  const STRIPE_CANCELED_AT = 1_750_500_000;
  const STRIPE_CANCELED_ISO = new Date(STRIPE_CANCELED_AT * 1000).toISOString();

  /**
   * Companies PATCH split on shape: the status mirror (no canceled_at filter)
   * returns the company with canceled_at as given; the guarded canceled_at
   * claim (filters on canceled_at=is.null) succeeds.
   */
  function companiesEndpoint(existingCanceledAt: string | null): StubEndpoint {
    return endpoint("PATCH", /\/rest\/v1\/companies/, (call) =>
      call.url.searchParams.get("canceled_at") === "is.null"
        ? [{ id: COMPANY_ID }]
        : [
            {
              id: COMPANY_ID,
              name: "Acme Plumbing",
              canceled_at: existingCanceledAt,
              company_modules: [],
            },
          ],
    );
  }

  it("a sync that discovers 'canceled' claims canceled_at, suspends numbers, and starts grace", async () => {
    const graceInserts: unknown[] = [];
    const harness = makeHarness([
      ...ledgerEndpoints(),
      // The reconcile/webhook re-fetch finds a cancellation nobody mirrored
      // (the deleted event was missed entirely).
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          status: "canceled",
          canceledAt: STRIPE_CANCELED_AT,
        }),
      ),
      companiesEndpoint(null),
      endpoint("POST", /\/rest\/v1\/grace_notices/, (call) => {
        graceInserts.push(call.json());
        return [{ company_id: COMPANY_ID }];
      }),
      ...recipientEndpoints(),
    ]);
    await deliver(
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );

    const patches = harness.callsTo("PATCH", /companies/);
    expect(patches).toHaveLength(2);
    // Mirror: canceled forces the pending-cancellation flag off.
    expect(patches[0].json()).toMatchObject({
      subscription_status: "canceled",
      cancel_at_period_end: false,
    });
    // Claim: Stripe's own cancellation moment, guarded first-writer-wins.
    expect(patches[1].url.searchParams.get("canceled_at")).toBe("is.null");
    expect(patches[1].json()).toEqual({ canceled_at: STRIPE_CANCELED_ISO });
    // The SAME machinery the deleted handler runs: suspend + day-1 notice.
    expect(suspendCompanyNumbers).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    expect(graceInserts).toEqual([
      {
        company_id: COMPANY_ID,
        canceled_at: STRIPE_CANCELED_ISO,
        threshold_day: 1,
      },
    ]);
    expect(harness.callsTo("POST", /api\.resend\.com/)).toHaveLength(1);
  });

  it("an already-claimed cancellation converges: no re-claim, no duplicate email", async () => {
    const EXISTING = "2026-06-20T00:00:00.000Z";
    const harness = makeHarness([
      ...ledgerEndpoints(),
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture({
          status: "canceled",
          canceledAt: STRIPE_CANCELED_AT,
        }),
      ),
      companiesEndpoint(EXISTING),
      // The grace ledger already carries day 1 for this cancellation.
      endpoint("POST", /\/rest\/v1\/grace_notices/, () => []),
      ...recipientEndpoints(),
    ]);
    await deliver(
      eventOf("customer.subscription.updated", subscriptionFixture()),
      harness,
    );

    // Only the status mirror — canceled_at is never overwritten (the grace
    // ledger keys on the one stored value).
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(1);
    expect(suspendCompanyNumbers).toHaveBeenCalledTimes(1); // idempotent
    expect(harness.callsTo("POST", /api\.resend\.com/)).toHaveLength(0);
  });
});

describe("one-shot email ledger (#52)", () => {
  it("payment-failed dunning sends once per attempt, replays never re-send", async () => {
    const claimed = new Set<string>();
    const buildHarness = () =>
      makeHarness([
        // Registered BEFORE ledgerEndpoints so this claim logic wins.
        endpoint("POST", /\/rest\/v1\/email_ledger/, (call) => {
          const row = call.json() as { email_key: string };
          if (claimed.has(row.email_key)) return [];
          claimed.add(row.email_key);
          return [row];
        }),
        ...ledgerEndpoints(),
        endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
          subscriptionFixture({ status: "past_due" }),
        ),
        endpoint("PATCH", /\/rest\/v1\/companies/, () => [
          { id: COMPANY_ID, name: "Acme Plumbing", canceled_at: null },
        ]),
        ...recipientEndpoints(),
      ]);

    // First delivery of attempt 1: claimed + emailed.
    const first = buildHarness();
    await deliver(
      eventOf("invoice.payment_failed", invoiceFixture({ attempt_count: 1 })),
      first,
    );
    expect(first.callsTo("POST", /email_ledger/)[0].json()).toEqual({
      company_id: COMPANY_ID,
      email_key: "invoice_payment_failed:in_1:1",
    });
    expect(first.callsTo("POST", /api\.resend\.com/)).toHaveLength(1);

    // A sweeper-style re-run of the same attempt: claim conflicts, no email.
    const replay = buildHarness();
    await deliver(
      eventOf("invoice.payment_failed", invoiceFixture({ attempt_count: 1 })),
      replay,
    );
    expect(replay.callsTo("POST", /api\.resend\.com/)).toHaveLength(0);

    // Stripe's NEXT retry (a genuinely new failure) still notifies.
    const nextAttempt = buildHarness();
    await deliver(
      eventOf("invoice.payment_failed", invoiceFixture({ attempt_count: 2 })),
      nextAttempt,
    );
    expect(nextAttempt.callsTo("POST", /api\.resend\.com/)).toHaveLength(1);
  });
});

describe("pending ports on paid checkout (PORTING.md §4 / D16 bridge number)", () => {
  const PORT_ID = "5f2b8f0a-7425-40de-944b-e07fc1f90ae8";

  /**
   * Registered BEFORE ledgerEndpoints so this port_requests GET wins over the
   * default empty one (makeHarness dispatches to the first matching endpoint).
   */
  function portEndpoints(port: Record<string, unknown>): StubEndpoint[] {
    return [
      endpoint("GET", /\/rest\/v1\/port_requests/, () => [port]),
      endpoint(
        "PATCH",
        /\/rest\/v1\/port_requests/,
        () => new Response(null, { status: 204 }),
      ),
    ];
  }

  /** The paid-checkout happy-path far side (no fee line, no suspended rows). */
  function checkoutEndpoints(): StubEndpoint[] {
    return [
      endpoint("GET", /api\.stripe\.com\/v1\/subscriptions\/sub_1/, () =>
        subscriptionFixture(),
      ),
      endpoint(
        "GET",
        /api\.stripe\.com\/v1\/checkout\/sessions\/cs_1\/line_items/,
        () => ({ object: "list", data: [] }),
      ),
      endpoint("PATCH", /\/rest\/v1\/companies/, () => new Response(null, { status: 204 })),
      endpoint("PATCH", /\/rest\/v1\/phone_numbers/, () => new Response(null, { status: 204 })),
    ];
  }

  it("provisions the opted-in bridge under its own key and links bridge_number_id", async () => {
    const harness = makeHarness([
      ...portEndpoints({
        id: PORT_ID,
        wants_bridge_number: true,
        bridge_number_id: null,
      }),
      ...ledgerEndpoints(),
      ...checkoutEndpoints(),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );

    // Bridge first (its own deterministic key + the bridge flag that ignores
    // the port's own source='ported' row), then the plain provisioning call
    // (which skips — a non-released number now exists under another key).
    expect(provisionCompanyNumber).toHaveBeenCalledTimes(2);
    expect(provisionCompanyNumber).toHaveBeenNthCalledWith(1, env, {
      companyId: COMPANY_ID,
      checkoutSessionId: `cs_1:bridge:${PORT_ID}`,
      bridge: true,
    });
    expect(provisionCompanyNumber).toHaveBeenNthCalledWith(2, env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_1",
    });
    expect(startPortSaga).toHaveBeenCalledExactlyOnceWith(env, {
      companyId: COMPANY_ID,
      portRequestId: PORT_ID,
    });

    // The durable port ↔ bridge link, guarded on bridge_number_id IS NULL so
    // overlapping runs never re-link.
    const links = harness.callsTo("PATCH", /port_requests/);
    expect(links).toHaveLength(1);
    expect(links[0].url.searchParams.get("id")).toBe(`eq.${PORT_ID}`);
    expect(links[0].url.searchParams.get("bridge_number_id")).toBe("is.null");
    expect(links[0].json()).toEqual({
      bridge_number_id: "bridge-number-double",
    });
  });

  it("redelivery converges: the duplicate event provisions NO second bridge", async () => {
    const seen = new Set<string>();
    const buildHarness = () =>
      makeHarness([
        ...portEndpoints({
          id: PORT_ID,
          wants_bridge_number: true,
          bridge_number_id: null,
        }),
        ...ledgerEndpoints(seen),
        ...checkoutEndpoints(),
      ]);
    const event = eventOf("checkout.session.completed", checkoutSessionFixture(), {
      id: "evt_bridge_replay",
    });

    const first = buildHarness();
    await deliver(event, first);
    const second = buildHarness();
    const response = await deliver(event, second);
    expect(await response.json()).toEqual({ received: true, duplicate: true });

    // Exactly ONE bridge-keyed provisioning call across both deliveries (the
    // provisioning_key backstop covers the sweeper/waitUntil overlap case —
    // provisioning.test.ts proves the same key converges on one row).
    const bridgeCalls = provisionCompanyNumber.mock.calls.filter(
      ([, input]) => input.bridge === true,
    );
    expect(bridgeCalls).toHaveLength(1);
    expect(first.callsTo("PATCH", /port_requests/)).toHaveLength(1);
    expect(second.callsTo("PATCH", /port_requests/)).toHaveLength(0);
  });

  it("a port whose bridge is already linked is not re-provisioned (sweeper re-run)", async () => {
    const harness = makeHarness([
      ...portEndpoints({
        id: PORT_ID,
        wants_bridge_number: true,
        bridge_number_id: "pn-bridge-existing",
      }),
      ...ledgerEndpoints(),
      ...checkoutEndpoints(),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );

    // Only the plain provisioning call — no second bridge, no re-link.
    expect(provisionCompanyNumber).toHaveBeenCalledExactlyOnceWith(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_1",
    });
    expect(harness.callsTo("PATCH", /port_requests/)).toHaveLength(0);
    expect(startPortSaga).toHaveBeenCalledTimes(1);
  });

  it("the port-documents nudge is ledgered — a handler re-run never re-emails (#52)", async () => {
    const claimed = new Set<string>();
    const buildHarness = () =>
      makeHarness([
        // Registered BEFORE ledgerEndpoints so this claim logic wins.
        endpoint("POST", /\/rest\/v1\/email_ledger/, (call) => {
          const row = call.json() as { email_key: string };
          if (claimed.has(row.email_key)) return [];
          claimed.add(row.email_key);
          return [row];
        }),
        ...portEndpoints({
          id: PORT_ID,
          phone_e164: "+15125550111",
          wants_bridge_number: false,
          bridge_number_id: null,
          telnyx_loa_document_id: null,
          telnyx_invoice_document_id: null,
        }),
        ...ledgerEndpoints(),
        ...checkoutEndpoints(),
      ]);

    const first = buildHarness();
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture(), {
        id: "evt_port_nudge_1",
      }),
      first,
    );
    expect(first.callsTo("POST", /email_ledger/)[0].json()).toEqual({
      company_id: COMPANY_ID,
      email_key: `port_documents_needed:${PORT_ID}`,
    });
    expect(sendPortEmail).toHaveBeenCalledTimes(1);

    // A sweeper-style re-run of the handler (a LATER step failed, the whole
    // thing replays under a fresh event): the claim conflicts, no re-send.
    const rerun = buildHarness();
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture(), {
        id: "evt_port_nudge_2",
      }),
      rerun,
    );
    expect(sendPortEmail).toHaveBeenCalledTimes(1);
  });

  it("a pending port WITHOUT the bridge opt-in starts the saga and buys nothing extra", async () => {
    const harness = makeHarness([
      ...portEndpoints({
        id: PORT_ID,
        wants_bridge_number: false,
        bridge_number_id: null,
      }),
      ...ledgerEndpoints(),
      ...checkoutEndpoints(),
    ]);
    await deliver(
      eventOf("checkout.session.completed", checkoutSessionFixture()),
      harness,
    );

    expect(startPortSaga).toHaveBeenCalledExactlyOnceWith(env, {
      companyId: COMPANY_ID,
      portRequestId: PORT_ID,
    });
    expect(provisionCompanyNumber).toHaveBeenCalledExactlyOnceWith(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_1",
    });
    expect(harness.callsTo("PATCH", /port_requests/)).toHaveLength(0);
  });
});
