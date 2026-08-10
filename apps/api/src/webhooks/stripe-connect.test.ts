/**
 * #224 — events about somebody else's Stripe account.
 *
 * Two things are being defended here and only one of them is obvious.
 *
 * THE OBVIOUS ONE: a customer paid, and the thread has to say so. Once, whatever
 * the delivery count — a redelivery and the five-minute sweeper both re-run this
 * path, and a second timeline row for one payment is a crew wondering whether
 * they were paid twice.
 *
 * THE ONE THAT MATTERS MORE: Connect events arrive on an endpoint anybody who
 * has ever created a Stripe account can reach. The object in the payload is
 * theirs and they control every field of it, so an event naming another
 * workspace's payment link must resolve to nothing. Every lookup is keyed on the
 * object AND `event.account`, and this suite is what proves the second half is
 * really there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch } from "../test/support";
import type { Stripe } from "../billing/stripe";
import { processStripeEvent } from "./stripe";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "22222222-0000-4000-8000-000000000022";
const ACCOUNT_ID = "acct_theirs_0001";
const OTHER_ACCOUNT = "acct_somebody_else";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * A faithful double of `api_mark_payment_request_paid`.
 *
 * Faithful specifically in the two places the SQL is load-bearing: it matches on
 * the payment link AND the account, and it refuses to write a second time.
 */
function buildHarness(rows: Record<string, unknown>[] = []) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("payment_requests");
  rest.table("conversation_events");
  rest.table("stripe_connect_accounts");
  for (const row of rows) rest.insert("payment_requests", row);

  rest.rpc("api_mark_payment_request_paid", (args) => {
    const row = rest
      .rows("payment_requests")
      .find(
        (candidate) =>
          candidate.stripe_payment_link_id === args.p_payment_link_id &&
          candidate.stripe_account_id === args.p_account,
      );
    if (!row) return { outcome: "unknown" };
    if (row.paid_at) return { outcome: "already_paid", payment_request_id: row.id };
    row.status = "paid";
    row.paid_at = new Date().toISOString();
    row.amount_received_cents = args.p_amount_received;
    row.stripe_charge_id = args.p_charge;
    return {
      outcome: "paid",
      payment_request_id: row.id,
      company_id: row.company_id,
      conversation_id: row.conversation_id,
      contact_id: row.contact_id,
      amount_cents: row.amount_cents,
      currency: row.currency,
      description: row.description,
      public_link_id: row.public_link_id ?? null,
    };
  });

  rest.rpc("api_mark_payment_request_settled", (args) => {
    const row = rest
      .rows("payment_requests")
      .find(
        (candidate) =>
          candidate.stripe_charge_id === args.p_charge &&
          candidate.stripe_account_id === args.p_account,
      );
    if (!row) return { outcome: "unknown" };
    if (args.p_kind === "refunded") {
      if (row.refunded_at) return { outcome: "noop" };
      row.refunded_at = new Date().toISOString();
      row.amount_refunded_cents = args.p_amount;
    } else {
      if (row.disputed_at) return { outcome: "noop" };
      row.disputed_at = new Date().toISOString();
    }
    return {
      outcome: args.p_kind,
      payment_request_id: row.id,
      company_id: row.company_id,
      conversation_id: row.conversation_id,
      amount_cents: row.amount_cents,
      amount_refunded_cents: row.amount_refunded_cents ?? null,
      currency: row.currency,
      description: row.description,
    };
  });

  rest.rpc("api_revoke_public_link", () => null);

  const stripeCalls: string[] = [];
  stubFetch(
    async (url) => {
      if (url.origin !== "https://api.stripe.com") return undefined;
      stripeCalls.push(url.pathname);
      if (url.pathname.startsWith("/v1/payment_intents/")) {
        return Response.json({
          id: "pi_0001",
          object: "payment_intent",
          latest_charge: "ch_0001",
        });
      }
      if (url.pathname.startsWith("/v1/accounts/")) {
        return Response.json({
          id: ACCOUNT_ID,
          object: "account",
          country: "US",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: { currently_due: [], disabled_reason: null, current_deadline: null },
        });
      }
      return Response.json({});
    },
    rest.route(),
  );

  return { env, rest, stripeCalls };
}

function openRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-0000-4000-8000-000000000077",
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    contact_id: "33333333-0000-4000-8000-000000000033",
    amount_cents: 25_000,
    currency: "usd",
    description: "Deposit for Tuesday",
    stripe_account_id: ACCOUNT_ID,
    stripe_payment_link_id: "plink_0001",
    public_link_id: "link-0001",
    status: "requested",
    paid_at: null,
    expires_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function checkoutEvent(account: string, linkId = "plink_0001"): Stripe.Event {
  return {
    id: "evt_0001",
    object: "event",
    account,
    type: "checkout.session.completed",
    created: 1_754_000_000,
    data: {
      object: {
        id: "cs_0001",
        object: "checkout.session",
        payment_status: "paid",
        payment_link: linkId,
        payment_intent: "pi_0001",
        amount_total: 25_000,
      },
    },
  } as unknown as Stripe.Event;
}

describe("#224 a connected account's checkout", () => {
  it("marks the request paid and says so in the thread", async () => {
    const harness = buildHarness([openRequest()]);
    await processStripeEvent(harness.env, checkoutEvent(ACCOUNT_ID));

    const row = harness.rest.rows("payment_requests")[0];
    expect(row.status).toBe("paid");
    expect(row.amount_received_cents).toBe(25_000);
    // The charge id, read from the payment intent ON the connected account. It
    // is the only thing a later refund or dispute can be matched by.
    expect(row.stripe_charge_id).toBe("ch_0001");

    const events = harness.rest.rows("conversation_events");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("payment_paid");
    // No actor: the customer did this, and stamping a crew member would put a
    // name against somebody else's action.
    expect(events[0].actor_user_id).toBeNull();
  });

  /**
   * The security control. A hostile connected account naming another
   * workspace's payment link must change nothing at all.
   */
  it("ignores an event whose account is not the one the request was made on", async () => {
    const harness = buildHarness([openRequest()]);
    await processStripeEvent(harness.env, checkoutEvent(OTHER_ACCOUNT));

    expect(harness.rest.rows("payment_requests")[0].status).toBe("requested");
    expect(harness.rest.rows("conversation_events")).toHaveLength(0);
  });

  it("writes one timeline row however many times the event is delivered", async () => {
    const harness = buildHarness([openRequest()]);
    await processStripeEvent(harness.env, checkoutEvent(ACCOUNT_ID));
    await processStripeEvent(harness.env, checkoutEvent(ACCOUNT_ID));
    await processStripeEvent(harness.env, checkoutEvent(ACCOUNT_ID));

    expect(harness.rest.rows("conversation_events")).toHaveLength(1);
  });

  it("does nothing for a session that has not actually been paid", async () => {
    const harness = buildHarness([openRequest()]);
    const event = checkoutEvent(ACCOUNT_ID);
    (event.data.object as { payment_status: string }).payment_status = "unpaid";
    await processStripeEvent(harness.env, event);

    expect(harness.rest.rows("payment_requests")[0].status).toBe("requested");
  });

  /**
   * The branch that keeps the two keyspaces apart. Without it a connected
   * account's checkout would reach `handleCheckoutCompleted`, which resolves a
   * workspace from a PLATFORM customer id — an id that does not exist on our
   * account at all.
   */
  it("never reaches the subscription handler", async () => {
    const harness = buildHarness([openRequest()]);
    await processStripeEvent(harness.env, checkoutEvent(ACCOUNT_ID));
    // The subscription path retrieves a Checkout Session and a Subscription.
    // The only Stripe call this path may make is the payment-intent read.
    expect(harness.stripeCalls).toEqual(["/v1/payment_intents/pi_0001"]);
  });
});

describe("#224 what happens after the money moved", () => {
  function refundEvent(account: string): Stripe.Event {
    return {
      id: "evt_refund",
      object: "event",
      account,
      type: "charge.refunded",
      created: 1_754_000_100,
      data: {
        object: { id: "ch_0001", object: "charge", amount_refunded: 25_000 },
      },
    } as unknown as Stripe.Event;
  }

  function disputeEvent(account: string): Stripe.Event {
    return {
      id: "evt_dispute",
      object: "event",
      account,
      type: "charge.dispute.created",
      created: 1_754_000_200,
      data: { object: { id: "dp_0001", object: "dispute", charge: "ch_0001" } },
    } as unknown as Stripe.Event;
  }

  it("puts a refund in the thread, and leaves the request paid", async () => {
    const harness = buildHarness([
      openRequest({
        status: "paid",
        paid_at: "2026-08-01T00:00:00Z",
        stripe_charge_id: "ch_0001",
      }),
    ]);
    await processStripeEvent(harness.env, refundEvent(ACCOUNT_ID));

    const row = harness.rest.rows("payment_requests")[0];
    // A refunded payment WAS paid. Collapsing that into the status would
    // destroy the fact the crew most needs.
    expect(row.status).toBe("paid");
    expect(row.refunded_at).toBeTruthy();
    expect(row.amount_refunded_cents).toBe(25_000);

    const events = harness.rest.rows("conversation_events");
    expect(events.map((event) => event.type)).toEqual(["payment_refunded"]);
  });

  it("puts a chargeback in the thread", async () => {
    const harness = buildHarness([
      openRequest({
        status: "paid",
        paid_at: "2026-08-01T00:00:00Z",
        stripe_charge_id: "ch_0001",
      }),
    ]);
    await processStripeEvent(harness.env, disputeEvent(ACCOUNT_ID));

    expect(harness.rest.rows("payment_requests")[0].disputed_at).toBeTruthy();
    expect(harness.rest.rows("conversation_events")[0].type).toBe("payment_disputed");
  });

  it("ignores a refund from an account that does not own the charge", async () => {
    const harness = buildHarness([
      openRequest({
        status: "paid",
        paid_at: "2026-08-01T00:00:00Z",
        stripe_charge_id: "ch_0001",
      }),
    ]);
    await processStripeEvent(harness.env, refundEvent(OTHER_ACCOUNT));

    expect(harness.rest.rows("payment_requests")[0].refunded_at).toBeFalsy();
    expect(harness.rest.rows("conversation_events")).toHaveLength(0);
  });
});

describe("#224 account.updated", () => {
  it("replaces the mirror wholesale", async () => {
    const harness = buildHarness();
    harness.rest.insert("stripe_connect_accounts", {
      company_id: COMPANY_ID,
      stripe_account_id: ACCOUNT_ID,
      country: "US",
      charges_enabled: false,
      details_submitted: false,
      // A stale reason that must NOT survive: left beside a fresh
      // charges_enabled it would read as restricted forever.
      disabled_reason: "requirements.past_due",
      requirements_due: ["external_account"],
    });

    await processStripeEvent(harness.env, {
      id: "evt_account",
      object: "event",
      account: ACCOUNT_ID,
      type: "account.updated",
      created: 1_754_000_300,
      data: {
        object: {
          id: ACCOUNT_ID,
          object: "account",
          country: "US",
          default_currency: "usd",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: {
            currently_due: [],
            disabled_reason: null,
            current_deadline: null,
          },
        },
      },
    } as unknown as Stripe.Event);

    const row = harness.rest.rows("stripe_connect_accounts")[0];
    expect(row.charges_enabled).toBe(true);
    expect(row.disabled_reason).toBeNull();
    expect(row.requirements_due).toEqual([]);
  });

  it("does nothing for an account we hold no row for", async () => {
    const harness = buildHarness();
    await processStripeEvent(harness.env, {
      id: "evt_account_unknown",
      object: "event",
      account: "acct_never_seen",
      type: "account.updated",
      created: 1_754_000_400,
      data: { object: { id: "acct_never_seen", object: "account" } },
    } as unknown as Stripe.Event);

    expect(harness.rest.rows("stripe_connect_accounts")).toHaveLength(0);
  });
});
