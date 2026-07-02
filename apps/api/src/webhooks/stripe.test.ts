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
import type { AppEnv } from "../context";
import {
  endpoint,
  makeExecutionContext,
  makeHarness,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
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
  } = {},
) {
  const {
    id = "sub_1",
    status = "active",
    licensed = env.STRIPE_STARTER_PRICE_ID,
    metered = env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    cancelAtPeriodEnd = false,
  } = overrides;
  return {
    id,
    object: "subscription",
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
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

/** webhook_events ledger: dedupes on event_id like the real PK does. */
function ledgerEndpoints(seen = new Set<string>()): StubEndpoint[] {
  return [
    endpoint("POST", /\/rest\/v1\/webhook_events/, (call) => {
      const row = call.json() as { event_id: string };
      if (seen.has(row.event_id)) return [];
      seen.add(row.event_id);
      return [{ event_id: row.event_id }];
    }),
    endpoint("GET", /\/rest\/v1\/webhook_events/, () => [{ attempts: 0 }]),
    endpoint("PATCH", /\/rest\/v1\/webhook_events/, () => new Response(null, { status: 204 })),
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
  options: { body?: string; header?: string | null } = {},
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
    env,
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

    // First delivery: ledger write + full processing (one companies write).
    expect(firstHarness.callsTo("PATCH", /companies/)).toHaveLength(1);
    expect(firstHarness.callsTo("GET", /subscriptions/)).toHaveLength(1);
    // Replay: the ONLY PostgREST traffic is the conflicting ledger insert.
    expect(secondHarness.callsTo("POST", /webhook_events/)).toHaveLength(1);
    expect(secondHarness.callsTo("PATCH", /companies/)).toHaveLength(0);
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

    const companyPatches = harness.callsTo("PATCH", /companies/);
    expect(companyPatches).toHaveLength(2);
    const activate = companyPatches[0];
    expect(activate.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
    expect(activate.json()).toEqual({
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      subscription_status: "active",
      plan: "starter",
      current_period_start: new Date(PERIOD_START * 1000).toISOString(),
      current_period_end: new Date(PERIOD_END * 1000).toISOString(),
      canceled_at: null,
      cancel_at_period_end: false,
    });
    // Fee stamp: gated on registration_fee_paid_at IS NULL (once ever, §2).
    const feeStamp = companyPatches[1];
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
    expect(harness.callsTo("PATCH", /companies/)).toHaveLength(1); // activate only
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
    expect(patches).toHaveLength(1);
    expect(patches[0].json()).toEqual({
      subscription_status: "canceled",
      canceled_at: canceledAt,
      cancel_at_period_end: false,
    });
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
