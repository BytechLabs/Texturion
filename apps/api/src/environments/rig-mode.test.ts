/**
 * D142: what rig mode adds, driven through the real Worker entry
 * (`handler.fetch`), the real webhook routes and the real delivery batch. The
 * only thing stubbed is the network edge, so "no request left" is a fact about
 * fetch, not a mock.
 */
import Stripe from "stripe";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { getEnv, type Bindings } from "../env";
import { app, handler } from "../index";
import { testExecutionContext, telnyxSigningKeys, signedTelnyxRequest } from "../test/messaging-support";
import { membershipResponder, supabaseStub, type SupabaseStub } from "../test/routes-harness";
import {
  OWNED_A,
  OWNED_B,
  RIG_ROBOT_ORIGIN,
  RIG_SUPABASE_URL,
  RIG_TELNYX_API_BASE,
  rigEnv,
  STRANGER,
} from "../test/rig-env";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { deliverWebhookBatch } from "../webhooks/outbound-deliver";

const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const SIMULATE = "/v1/rig/simulate-incoming";
/** The rig asks its database this before serving anything; it writes nothing. */
const POSTURE = "/rest/v1/rpc/rig_database_posture";

/** Every request that left for somewhere other than the rig's database. */
function outside(): { requests: string[]; route: (url: URL) => Response } {
  const requests: string[] = [];
  return {
    requests,
    route: (url: URL) => {
      requests.push(url.href);
      return Response.json({ data: { result: "ok" } });
    },
  };
}

async function dispatch(
  bindings: Bindings,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  headers.set("X-Company-Id", COMPANY_ID);
  const { ctx, flush } = testExecutionContext();
  const response = await handler.fetch(
    new Request(`https://api.loonext.com${path}`, { ...init, headers }),
    bindings,
    ctx,
  );
  await flush();
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/rig/simulate-incoming exists only on the rig", () => {
  // One signer per JWKS URL: the verifier caches the key set by URL, and
  // production and local share completeEnv()'s.
  let auth: TestAuth;
  beforeAll(async () => {
    auth = await createTestAuth(getEnv(completeEnv()));
  });

  it("is absent from production's route table", () => {
    expect(app.routes.filter((route) => route.path.includes("/rig"))).toEqual([]);
  });

  it.each([
    ["production", { ...completeEnv(), DEPLOY_ENV: "production" }],
    ["local", completeEnv()],
  ])("answers an authenticated member 404 in %s, and sends nothing", async (_name, bindings) => {
    const env = getEnv(bindings);
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "owner"));
    stubFetch(jwksRoute(auth), sb.route);
    const response = await dispatch(bindings, SIMULATE, {
      method: "POST",
      token: await auth.token(),
    });
    expect(response.status).toBe(404);
    expect(sb.calls.map((call) => call.path)).toEqual(["/rest/v1/rpc/api_authorize_request"]);
  });

  it("is mounted behind authentication on the rig", async () => {
    const env = getEnv(rigEnv());
    const auth = await createTestAuth(env);
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    const response = await dispatch(rigEnv(), SIMULATE, { method: "POST" });
    expect(response.status).toBe(401);
  });
});

describe("a simulated incoming call never dials", () => {
  let auth: TestAuth;
  beforeAll(async () => {
    auth = await createTestAuth(getEnv(rigEnv()));
  });

  function world(): { sb: SupabaseStub; elsewhere: ReturnType<typeof outside> } {
    const sb = supabaseStub(getEnv(rigEnv()));
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "owner"));
    sb.on("GET", "/rest/v1/company_members", () => [{ user_id: auth.subject }]);
    // No call row exists for a synthetic session, and no device is registered.
    sb.on("GET", /^\/rest\/v1\//, () => []);
    return { sb, elsewhere: outside() };
  }

  it("wakes a member, then refuses ring-me before anything reaches Telnyx", async () => {
    const { sb, elsewhere } = world();
    stubFetch(jwksRoute(auth), sb.route, (url) =>
      url.origin === RIG_SUPABASE_URL ? undefined : elsewhere.route(url),
    );
    const token = await auth.token();

    const simulated = await dispatch(rigEnv(), SIMULATE, {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caller: "Robot" }),
    });
    expect(simulated.status).toBe(201);
    const { session_id: sessionId } = (await simulated.json()) as { session_id: string };
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const ringMe = await dispatch(rigEnv(), `/v1/calls/live/${sessionId}/ring-me`, {
      method: "POST",
      token,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(ringMe.status).toBe(404);
    expect(elsewhere.requests.filter((href) => href.startsWith(RIG_TELNYX_API_BASE))).toEqual([]);
    expect(elsewhere.requests.filter((href) => href.includes("telnyx"))).toEqual([]);
  });
});

describe("the inbound gate at the Telnyx webhook", () => {
  let keys: Awaited<ReturnType<typeof telnyxSigningKeys>>;
  beforeAll(async () => {
    keys = await telnyxSigningKeys();
  });

  const bindings = () => rigEnv({ TELNYX_PUBLIC_KEY: keys.publicKeyB64 });

  async function deliver(event: unknown): Promise<Response> {
    const signed = await signedTelnyxRequest(keys.privateKey, event);
    const { ctx, flush } = testExecutionContext();
    const response = await handler.fetch(signed, bindings(), ctx);
    await flush();
    return response;
  }

  const text = (from: string) => ({
    data: {
      id: `evt-${Math.random()}`,
      event_type: "message.received",
      payload: { from: { phone_number: from }, to: [{ phone_number: OWNED_A }], text: "hi" },
    },
  });
  const call = (from: string | undefined) => ({
    data: {
      id: `evt-${Math.random()}`,
      event_type: "call.initiated",
      payload: { direction: "incoming", from, to: OWNED_A, call_control_id: "ccid-stranger" },
    },
  });

  it("drops a stranger's text before the ledger", async () => {
    // No database responder at all: any write would throw and fail the test.
    const sb = supabaseStub(getEnv(bindings()));
    stubFetch(sb.route);
    const response = await deliver(text(STRANGER));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(sb.calls.map((call) => call.path)).toEqual([POSTURE]);
  });

  it.each([
    ["a stranger", STRANGER],
    ["a withheld caller", undefined],
  ])("rejects a call from %s outright, through the guard, and records nothing", async (_l, from) => {
    const sb = supabaseStub(getEnv(bindings()));
    const sent: string[] = [];
    stubFetch(sb.route, (url) => {
      if (url.origin === RIG_SUPABASE_URL) return undefined;
      sent.push(url.href);
      return Response.json({ data: { result: "ok" } });
    });
    const response = await deliver(call(from));
    expect(response.status).toBe(200);
    expect(sent).toEqual([`${RIG_TELNYX_API_BASE}/v2/calls/ccid-stranger/actions/reject`]);
    expect(sb.calls.map((call) => call.path)).toEqual([POSTURE]);
  });

  it("lets the partition's own numbers through to the ledger", async () => {
    const sb = supabaseStub(getEnv(bindings()));
    sb.on("POST", "/rest/v1/webhook_events", () => []);
    stubFetch(sb.route);
    const response = await deliver(text(OWNED_B));
    expect(response.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/webhook_events")).toHaveLength(1);
  });

  it("does nothing of the kind outside the rig", async () => {
    const sb = supabaseStub(getEnv(completeEnv()));
    sb.on("POST", "/rest/v1/webhook_events", () => []);
    stubFetch(sb.route);
    const signed = await signedTelnyxRequest(keys.privateKey, text(STRANGER));
    const { ctx, flush } = testExecutionContext();
    const response = await handler.fetch(
      signed,
      { ...completeEnv(), TELNYX_PUBLIC_KEY: keys.publicKeyB64 },
      ctx,
    );
    await flush();
    expect(response.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/webhook_events")).toHaveLength(1);
  });
});

describe("live Stripe events on the rig", () => {
  const signer = new Stripe("sk_test_signer_only");

  async function deliver(bindings: Bindings, livemode: boolean): Promise<Response> {
    const payload = JSON.stringify({
      id: `evt_${livemode ? "live" : "test"}`,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: "customer.updated",
      data: { object: { id: "cus_1", object: "customer" } },
    });
    const signature = signer.webhooks.generateTestHeaderString({
      payload,
      secret: getEnv(bindings).STRIPE_WEBHOOK_SECRET,
    });
    const { ctx, flush } = testExecutionContext();
    const response = await handler.fetch(
      new Request("https://api.loonext.com/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": signature, "content-type": "application/json" },
        body: payload,
      }),
      bindings,
      ctx,
    );
    await flush();
    return response;
  }

  it("refuses a live-mode event before the ledger", async () => {
    const sb = supabaseStub(getEnv(rigEnv()));
    stubFetch(sb.route);
    const response = await deliver(rigEnv(), true);
    expect(response.status).toBe(403);
    expect(sb.calls.map((call) => call.path)).toEqual([POSTURE]);
  });

  it("takes a sandbox event to the ledger", async () => {
    const sb = supabaseStub(getEnv(rigEnv()));
    sb.on("POST", "/rest/v1/webhook_events", () => []);
    stubFetch(sb.route);
    const response = await deliver(rigEnv(), false);
    expect(response.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/webhook_events")).toHaveLength(1);
  });
});

describe("customer webhooks on the rig", () => {
  function world(url: string): { sb: SupabaseStub; posted: string[] } {
    const env = getEnv(rigEnv());
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_claim_webhook_deliveries", () => [
      {
        id: "del-1",
        company_id: COMPANY_ID,
        endpoint_id: "ep-1",
        event_type: "message.received",
        payload: { id: "e1" },
        attempts: 1,
      },
    ]);
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [
      { id: "ep-1", url, secret: "whsec_x", consecutive_failures: 0, active: true },
    ]);
    sb.on("PATCH", /^\/rest\/v1\/webhook_(?:deliveries|endpoints)$/, () => []);
    const posted: string[] = [];
    stubFetch(sb.route, (target) => {
      if (target.origin === RIG_SUPABASE_URL) return undefined;
      posted.push(target.href);
      return new Response(null, { status: 204 });
    });
    return { sb, posted };
  }

  it("go nowhere but the robot", async () => {
    const { sb, posted } = world("https://hooks.example.com/loonext");
    const env = getEnv(rigEnv());
    const result = await deliverWebhookBatch(getDb(env), env);
    expect(posted).toEqual([]);
    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    const update = sb.find("PATCH", "/rest/v1/webhook_deliveries")[0];
    expect(update.body).toMatchObject({ status: "failed" });
  });

  it("reach the robot", async () => {
    const { posted } = world(`${RIG_ROBOT_ORIGIN}/hooks/qa-w`);
    const env = getEnv(rigEnv());
    const result = await deliverWebhookBatch(getDb(env), env);
    expect(posted).toEqual([`${RIG_ROBOT_ORIGIN}/hooks/qa-w`]);
    expect(result).toMatchObject({ delivered: 1 });
  });
});
