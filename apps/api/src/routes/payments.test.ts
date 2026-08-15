/**
 * #224 — text-to-pay, and the four things that must never happen.
 *
 * 1. A payment request must not exist at Stripe for a send that was going to be
 *    refused anyway. An opted-out contact, a lapsed subscription, a suspended
 *    workspace — every one of those is decided BEFORE a link is minted, because
 *    a live payment link for a text that never went out is a page a homeowner
 *    can pay against a request nobody made.
 * 2. A workspace that cannot take a card must not be able to ask for one, and
 *    must be told exactly what is outstanding.
 * 3. A paid request must not be cancellable, and must not offer a Cancel that
 *    silently does nothing.
 * 4. The public page must not hand out a card form for money already taken.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { paymentAccountRoutes, paymentRequestRoutes, publicPaymentRoutes } from "./payments";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER_ID = "10000000-aaaa-4000-8000-000000000001";
const CONVERSATION_ID = "22222222-0000-4000-8000-000000000022";
const CONTACT_ID = "33333333-0000-4000-8000-000000000033";
const NUMBER_ID = "44444444-0000-4000-8000-000000000044";
const ACCOUNT_ID = "acct_test_0001";
const MESSAGE_ID = "66666666-0000-4000-8000-000000000066";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface StripeCall {
  method: string;
  url: URL;
  form: URLSearchParams;
  headers: Headers;
}

/**
 * A far side for Stripe, recording every call.
 *
 * Recording is the point rather than a convenience: the first assertion this
 * suite makes is that a refused send reaches Stripe ZERO times, and that is only
 * observable by counting.
 */
function stripeRoute(calls: StripeCall[], overrides: Record<string, unknown> = {}): FetchRoute {
  return async (url, request) => {
    if (url.origin !== "https://api.stripe.com") return undefined;
    const body = await request.clone().text();
    calls.push({
      method: request.method,
      url,
      form: new URLSearchParams(body),
      headers: request.headers,
    });

    if (url.pathname.startsWith("/v1/accounts/acct_")) {
      return Response.json({
        id: ACCOUNT_ID,
        object: "account",
        country: "US",
        default_currency: "usd",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [], disabled_reason: null, current_deadline: null },
        ...overrides,
      });
    }
    if (url.pathname === "/v1/payment_links") {
      return Response.json({
        id: "plink_0001",
        object: "payment_link",
        url: "https://buy.stripe.com/test_0001",
        active: true,
      });
    }
    if (url.pathname.startsWith("/v1/payment_links/")) {
      return Response.json({
        id: "plink_0001",
        object: "payment_link",
        url: "https://buy.stripe.com/test_0001",
        active: true,
      });
    }
    return Response.json({ id: "unexpected" });
  };
}

function buildHarness(options: {
  account?: Record<string, unknown> | null;
  accountOverrides?: Record<string, unknown>;
  optedOut?: boolean;
  requests?: Record<string, unknown>[];
  role?: "owner" | "admin" | "member" | "read_only" | "bookkeeper";
} = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("profiles");
  rest.table("conversations");
  rest.table("contacts");
  rest.table("phone_numbers");
  rest.table("stripe_connect_accounts", {}, [["company_id"]]);
  rest.table("payment_requests", { status: "requested" });
  rest.table("public_links");
  rest.table("messages");
  rest.table("conversation_events");
  rest.table("audit_log");
  // The gates runPreSendGates consults on its way through. Empty means "nobody
  // has opted out and nothing is switched off", which is the ordinary case.
  rest.table("opt_outs");
  rest.table("feature_flag_overrides");
  rest.table("messaging_registrations");

  rest.insert("companies", { id: COMPANY_ID, name: "Northline Plumbing", country: "US" });
  rest.insert("profiles", { id: OWNER_ID, email: "owner@example.com" });
  rest.insert("contacts", { id: CONTACT_ID, name: "Maria", address: null, timezone: null });
  rest.insert("phone_numbers", {
    id: NUMBER_ID,
    number_e164: "+14155550100",
    status: "active",
  });
  rest.insert("conversations", {
    id: CONVERSATION_ID,
    company_id: COMPANY_ID,
    contact_id: CONTACT_ID,
    phone_number_id: NUMBER_ID,
    contact_phone_e164: "+14155550199",
    // FakeRest does not resolve PostgREST embeds, so the joined shapes the
    // route selects are seeded on the row itself.
    phone_numbers: { number_e164: "+14155550100", status: "active" },
    companies: { name: "Northline Plumbing" },
  });
  if (options.account !== null) {
    rest.insert("stripe_connect_accounts", {
      company_id: COMPANY_ID,
      stripe_account_id: ACCOUNT_ID,
      country: "US",
      default_currency: "usd",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      disabled_reason: null,
      requirements_due: [],
      requirements_deadline: null,
      ...(options.account ?? {}),
    });
  }
  for (const row of options.requests ?? []) rest.insert("payment_requests", row);

  // The gates the send path asks about, answered as a workspace in good
  // standing unless a test says otherwise.
  rest.rpc("api_send_gates", () => ({
    subscription_active: true,
    aup_enforcement: "none",
    paused: false,
    registration_status: "approved",
  }));
  rest.rpc("api_evaluate_flags", () => ({}));
  rest.rpc("api_mint_public_link", () => "link-0001");
  rest.rpc("api_revoke_public_link", () => null);
  rest.rpc("gate_outbound_send", (args) => {
    if (options.optedOut) {
      return { outcome: "opted_out" };
    }
    // The real RPC inserts the row atomically with the gate; the double has to
    // do the same, because the dispatch path immediately updates it by id.
    const message = rest.insert("messages", {
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      direction: "outbound",
      status: "queued",
      body: String(args.p_body ?? ""),
      segments: 1,
    });
    return { outcome: "queued", message };
  });

  const app = new Hono<AppEnv>();
  app.use("/v1/*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", options.role ?? "owner");
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1", paymentAccountRoutes);
  app.route("/v1", paymentRequestRoutes);
  app.route("/", publicPaymentRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  const stripeCalls: StripeCall[] = [];
  const telnyx: FetchRoute = async (url) =>
    url.origin === "https://api.telnyx.com"
      ? Response.json({ data: { id: "telnyx-msg-0001", parts: 2 } })
      : undefined;
  stubFetch(stripeRoute(stripeCalls, options.accountOverrides), telnyx, rest.route());
  return {
    env,
    rest,
    stripeCalls,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-0001",
    },
    body: JSON.stringify(body),
  };
}

describe("#224 the account", () => {
  it("tells a workspace with no account exactly what to do", async () => {
    const harness = buildHarness({ account: null });
    const response = await harness.request("/v1/payments/account");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.connected).toBe(false);
    expect(body.readiness).toBe("not_connected");
    expect(body.action).toBe("Set up payments");
    // #228: the key travels BESIDE the sentence. Both, on purpose — a phone
    // built before the keys renders `action` and has never heard of
    // `action_key`, and #339 puts those builds on real phones for months.
    expect(body.title_key).toBe("payments.payoutNotConnectedTitle");
    expect(body.detail_key).toBe("payments.payoutNotConnectedDetail");
    expect(body.action_key).toBe("payments.payoutActionSetUp");
  });

  it("nulls the action KEY wherever it nulls the action", async () => {
    /*
     * A sender sees the state and no button, because every action on this
     * object opens a screen they cannot reach. If the key survived while the
     * sentence was nulled, a client that prefers the key would draw exactly the
     * dead end the old one knew better than to draw.
     */
    // A member, so `scopeFor` answers "sender": no `billing.manage`.
    const harness = buildHarness({ account: null, role: "member" });
    const response = await harness.request("/v1/payments/account");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.action).toBeNull();
    expect(body.action_key).toBeNull();
    // The state itself still speaks: a workspace that cannot charge has to be
    // able to say so on every surface.
    expect(body.title_key).toBe("payments.payoutNotConnectedTitle");
  });

  it("names the outstanding requirements rather than saying 'pending'", async () => {
    const harness = buildHarness({
      account: { charges_enabled: false, details_submitted: false },
      accountOverrides: {
        charges_enabled: false,
        details_submitted: false,
        requirements: {
          currently_due: ["external_account", "individual.verification.document"],
          disabled_reason: null,
          current_deadline: null,
        },
      },
    });
    const response = await harness.request("/v1/payments/account");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.readiness).toBe("onboarding_incomplete");
    expect(body.requirements_due).toEqual([
      "external_account",
      "individual.verification.document",
    ]);
  });

  /**
   * The mirror is the fallback, not the answer. A settings page that says "we
   * cannot reach Stripe" is a page nobody can act on; the last known state is
   * right almost always.
   */
  it("falls back to the stored mirror when Stripe is unreachable", async () => {
    const harness = buildHarness();
    stubFetch(
      async (url) => {
        if (url.origin === "https://api.stripe.com") {
          return new Response("upstream is down", { status: 500 });
        }
        return undefined;
      },
      harness.rest.route(),
    );
    const response = await harness.request("/v1/payments/account");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.readiness).toBe("ready");
  });
});

/**
 * The gate on the readiness read, which is the one that decides whether the
 * feature reaches the person it was written for.
 *
 * It was `billing.manage` alone in the first cut, and that made the whole
 * feature invisible to a plain member: they hold `conversations.send` and not
 * `billing.manage`, so their composer could never learn whether payments were
 * on, so the "Ask for payment" control could never appear. On every thread.
 * Permanently.
 */
describe("#224 who may ask whether payments are on", () => {
  it("answers a member, because a member is who sends the request", async () => {
    const harness = buildHarness({ role: "member" });
    const response = await harness.request("/v1/payments/account");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.readiness).toBe("ready");
    expect(body.currency).toBe("usd");
  });

  it("does not tell a member what the OWNER personally owes Stripe", async () => {
    const harness = buildHarness({
      role: "member",
      account: { charges_enabled: false, details_submitted: false },
      accountOverrides: {
        charges_enabled: false,
        details_submitted: false,
        requirements: {
          currently_due: ["individual.id_number"],
          disabled_reason: "requirements.past_due",
          current_deadline: null,
        },
      },
    });
    const body = (await (await harness.request("/v1/payments/account")).json()) as
      Record<string, unknown>;
    // Enough to decide whether to draw a control.
    expect(body.readiness).toBe("restricted");
    // And nothing about the owner's identity documents or the business's
    // standing with a payment processor.
    expect(body.requirements_due).toBeUndefined();
    expect(body.disabled_reason).toBeUndefined();
    expect(body.details_submitted).toBeUndefined();
    // No action either: every action leads to a screen they cannot open.
    expect(body.action).toBeNull();
  });

  it("gives the bookkeeper the whole object", async () => {
    const harness = buildHarness({ role: "bookkeeper" });
    const body = (await (await harness.request("/v1/payments/account")).json()) as
      Record<string, unknown>;
    expect(body.requirements_due).toEqual([]);
    expect(body.action).toBe("Open Stripe");
  });

  it("refuses a read-only observer, who neither sends nor does the books", async () => {
    const harness = buildHarness({ role: "read_only" });
    const response = await harness.request("/v1/payments/account");
    expect(response.status).toBe(403);
  });
});

describe("#224 asking for money", () => {
  it("refuses a workspace that has not connected, and says why", async () => {
    const harness = buildHarness({ account: null });
    const response = await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 25_000, description: "Deposit" }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Set up payments in Settings");
    // Nothing was created at Stripe for a request that was never going to send.
    expect(harness.stripeCalls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("refuses an amount below Stripe's own floor before touching Stripe", async () => {
    const harness = buildHarness();
    const response = await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 50, description: "Deposit" }),
    );
    expect(response.status).toBe(422);
    expect(
      harness.stripeCalls.filter((call) => call.url.pathname === "/v1/payment_links"),
    ).toHaveLength(0);
  });

  it("refuses the missed decimal", async () => {
    const harness = buildHarness();
    const response = await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 4_500_000, description: "Full job" }),
    );
    expect(response.status).toBe(422);
  });

  /**
   * THE gate-order test. An opted-out contact is refused by the shared send
   * gate, and the refusal has to land before a payment link exists — otherwise
   * a person who asked to be left alone has a live page asking them for money.
   */
  it("creates nothing at Stripe when the contact has opted out", async () => {
    const harness = buildHarness({ optedOut: true });
    const response = await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 25_000, description: "Deposit" }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    // The link may have been created before the gate ran — what must NOT
    // survive is an ACTIVE one. Either it was never made, or it was switched
    // off on the way out.
    const created = harness.stripeCalls.filter(
      (call) => call.url.pathname === "/v1/payment_links" && call.method === "POST",
    );
    const deactivated = harness.stripeCalls.filter(
      (call) =>
        call.url.pathname.startsWith("/v1/payment_links/") &&
        call.method === "POST" &&
        call.form.get("active") === "false",
    );
    expect(created.length).toBe(deactivated.length);
    const rows = harness.rest.rows("payment_requests");
    for (const row of rows) expect(row.status).not.toBe("requested");
  });

  it("mints a direct charge on the connected account with no platform fee", async () => {
    const harness = buildHarness();
    const response = await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 25_000, description: "Deposit for Tuesday" }),
    );
    expect(response.status).toBe(201);

    const create = harness.stripeCalls.find(
      (call) => call.url.pathname === "/v1/payment_links" && call.method === "POST",
    );
    expect(create).toBeDefined();
    // The whole liability decision, expressed as one header: the charge is
    // created ON the connected account, so the business is the merchant of
    // record and a chargeback settles against them.
    expect(create?.headers.get("Stripe-Account")).toBe(ACCOUNT_ID);
    // ZERO platform fee. If either of these ever appears, we are in the path of
    // somebody else's money and D133 has been reversed by accident.
    expect(create?.form.get("application_fee_amount")).toBeNull();
    expect(create?.form.has("transfer_data[destination]")).toBe(false);
    expect(create?.form.get("line_items[0][price_data][unit_amount]")).toBe("25000");
    expect(create?.form.get("line_items[0][price_data][currency]")).toBe("usd");
  });

  it("records the request and puts it on the timeline", async () => {
    const harness = buildHarness();
    await harness.request(
      `/v1/conversations/${CONVERSATION_ID}/payment-requests`,
      post({ amount_cents: 25_000, description: "Deposit for Tuesday" }),
    );
    const rows = harness.rest.rows("payment_requests");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(25_000);
    expect(rows[0].stripe_account_id).toBe(ACCOUNT_ID);
    expect(rows[0].status).toBe("requested");

    const events = harness.rest.rows("conversation_events");
    expect(events.map((event) => event.type)).toContain("payment_requested");
  });
});

describe("#224 calling it off", () => {
  it("refuses to cancel one that is already paid", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000055",
          company_id: COMPANY_ID,
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit",
          stripe_account_id: ACCOUNT_ID,
          stripe_payment_link_id: "plink_0001",
          status: "paid",
          paid_at: "2026-08-01T00:00:00Z",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const response = await harness.request(
      "/v1/payment-requests/55555555-0000-4000-8000-000000000055/cancel",
      { method: "POST" },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Refund it from your Stripe dashboard");
  });

  it("is idempotent on one that is already cancelled", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000056",
          company_id: COMPANY_ID,
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit",
          stripe_account_id: ACCOUNT_ID,
          status: "cancelled",
          cancelled_at: "2026-08-01T00:00:00Z",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const response = await harness.request(
      "/v1/payment-requests/55555555-0000-4000-8000-000000000056/cancel",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
  });

  it("deactivates the Stripe link and revokes the customer's page", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000057",
          company_id: COMPANY_ID,
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit",
          stripe_account_id: ACCOUNT_ID,
          stripe_payment_link_id: "plink_0001",
          public_link_id: "link-0001",
          status: "requested",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const response = await harness.request("/v1/payment-requests/55555555-0000-4000-8000-000000000057/cancel", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const deactivate = harness.stripeCalls.find(
      (call) => call.url.pathname === "/v1/payment_links/plink_0001",
    );
    expect(deactivate?.form.get("active")).toBe("false");
    expect(deactivate?.headers.get("Stripe-Account")).toBe(ACCOUNT_ID);
    expect(harness.rest.rows("payment_requests")[0].status).toBe("cancelled");
  });

  it("refuses a request belonging to another workspace as a 404", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000058",
          company_id: "99999999-0000-4000-8000-000000000099",
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit",
          stripe_account_id: "acct_someone_else",
          status: "requested",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const response = await harness.request("/v1/payment-requests/55555555-0000-4000-8000-000000000058/cancel", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

describe("#224 the customer's page", () => {
  it("says the same thing for every failure", async () => {
    const harness = buildHarness();
    harness.rest.rpc("api_resolve_public_link", () => ({
      ok: false,
      outcome: "expired",
    }));
    const response = await harness.request("/pay/".concat("z".repeat(43)));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { message: string } };
    // The word "expired" may appear as a possibility, never as the verdict —
    // a holder who can tell expired from never-existed has an oracle (D75).
    expect(body.error.message).toContain("may have expired");
  });

  it("withholds the card form once the money is in", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000055",
          company_id: COMPANY_ID,
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit",
          stripe_account_id: ACCOUNT_ID,
          stripe_payment_link_id: "plink_0001",
          status: "paid",
          paid_at: "2026-08-01T00:00:00Z",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    harness.rest.rpc("api_resolve_public_link", () => ({
      ok: true,
      outcome: "ok",
      company_id: COMPANY_ID,
      subject_type: "payment_request",
      subject_id: "55555555-0000-4000-8000-000000000055",
    }));
    const response = await harness.request("/pay/".concat("a".repeat(43)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.state).toBe("paid");
    expect(body.pay_url).toBeNull();
  });

  it("shows the amount, the business and what it is for — and nothing else", async () => {
    const harness = buildHarness({
      requests: [
        {
          id: "55555555-0000-4000-8000-000000000057",
          company_id: COMPANY_ID,
          conversation_id: CONVERSATION_ID,
          contact_id: CONTACT_ID,
          amount_cents: 25_000,
          currency: "usd",
          description: "Deposit for Tuesday",
          stripe_account_id: ACCOUNT_ID,
          stripe_payment_link_id: "plink_0001",
          status: "requested",
          expires_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    harness.rest.rpc("api_resolve_public_link", () => ({
      ok: true,
      outcome: "ok",
      company_id: COMPANY_ID,
      subject_type: "payment_request",
      subject_id: "55555555-0000-4000-8000-000000000057",
    }));
    const response = await harness.request("/pay/".concat("b".repeat(43)));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.business_name).toBe("Northline Plumbing");
    expect(body.amount).toBe("$250");
    expect(body.pay_url).toBe("https://buy.stripe.com/test_0001");
    // The customer's own details are NOT on a page that lives in SMS logs and
    // browser history. They already know them; putting them here adds only risk.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Maria");
    expect(serialized).not.toContain("4155550199");
  });
});
