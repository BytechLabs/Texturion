/**
 * GET /v1/calls (#129 Calls feature): the number-access-filtered call log.
 * Real product code over the stubbed network edge (D13).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import { stubRoute, type Stub } from "../test/messaging-support";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { callsRoutes } from "./calls";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const HIDDEN_NUMBER = "11111111-2222-4333-8444-555555555555";

let auth: TestAuth;
const app = buildTestApp(callsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    caller_e164: "+16135551000",
    contact_id: null,
    contact_name: "Dana Roofer",
    phone_number_id: "bbbbbbbb-0000-4000-8000-000000000002",
    conversation_id: "cccccccc-0000-4000-8000-000000000003",
    outcome: "missed",
    forward_seconds: 0,
    started_at: "2026-07-10T15:00:00+00:00",
    ...overrides,
  };
}

function callsStub(
  rows: unknown[],
  opts: { role?: string; accessRules?: unknown[] } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, opts.role ?? "member"),
  );
  // #106 resolver: member-role reads number_access rules (empty = no rules).
  sb.on("GET", "/rest/v1/number_access", () => opts.accessRules ?? []);
  sb.on("POST", "/rest/v1/rpc/api_list_calls", () => rows);
  return sb;
}

describe("GET /v1/calls", () => {
  it("returns the page envelope with the RPC's rows", async () => {
    const sb = callsStub([callRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [callRow()],
      next_cursor: null,
    });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_calls")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_limit: 26, // limit + 1 sentinel row
      p_outcome: null,
      p_cursor_ts: null,
      p_cursor_id: null,
    });
  });

  it("passes the #106 deny list into the SQL for a restricted member", async () => {
    const sb = callsStub([], {
      accessRules: [
        { user_id: MEMBER_ID, phone_number_id: HIDDEN_NUMBER, level: "none" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);

    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_calls")[0];
    expect(rpc.body).toMatchObject({
      p_hidden_number_ids: [HIDDEN_NUMBER],
    });
  });

  it("owner short-circuits unrestricted (null deny list, no rules read)", async () => {
    const sb = callsStub([callRow()], { role: "owner" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_calls")[0];
    expect((rpc.body as { p_hidden_number_ids: unknown }).p_hidden_number_ids).toBe(
      null,
    );
    expect(sb.find("GET", "/rest/v1/number_access")).toHaveLength(0);
  });

  it("narrows on ?outcome= and rejects garbage values", async () => {
    const sb = callsStub([]);
    stubFetch(jwksRoute(auth), sb.route);

    const ok = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls?outcome=missed",
      { companyId: COMPANY_ID },
    );
    expect(ok.status).toBe(200);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calls")[0].body,
    ).toMatchObject({ p_outcome: "missed" });

    const bad = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls?outcome=ring",
      { companyId: COMPANY_ID },
    );
    expect(bad.status).toBe(422);
  });

  it("emits a next_cursor when the sentinel row overflows the page", async () => {
    const rows = [
      callRow({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      callRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        started_at: "2026-07-10T14:00:00+00:00",
      }),
    ];
    const sb = callsStub(rows);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls?limit=1",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      data: unknown[];
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).toEqual(expect.any(String));
  });
});

/**
 * D40 (#133) cell verification: PUT texts a code from the business number
 * (a raw Telnyx send — no messages row, never metered), verify checks it
 * attempt-capped, and only a verified cell dials.
 */
describe("POST /v1/calls/browser (D43)", () => {
  const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";

  function browserWorld(
    opts: {
      subscriptionStatus?: string;
      voiceSeconds?: number;
      inflight?: unknown[];
      role?: string;
    } = {},
  ): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, opts.role ?? "member"),
    );
    sb.on("GET", "/rest/v1/number_access", () => []);
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        id: CONVERSATION,
        contact_id: "aaaaaaaa-0000-4000-8000-000000000009",
        phone_number_id: "bbbbbbbb-0000-4000-8000-000000000002",
        contacts: { phone_e164: "+16135551000" },
        phone_numbers: { number_e164: "+16135550100", status: "active" },
      },
    ]);
    sb.on("GET", "/rest/v1/companies", () => [
      {
        plan: "starter",
        current_period_start: "2026-07-01T00:00:00Z",
        overage_cap_multiplier: "3.00",
        subscription_status: opts.subscriptionStatus ?? "active",
      },
    ]);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_period_forward_seconds",
      () => opts.voiceSeconds ?? 0,
    );
    sb.on("GET", "/rest/v1/calls", () => opts.inflight ?? []);
    return sb;
  }

  it("authorizes: returns the from/to numbers and the oc_customer tag — no Telnyx dial", async () => {
    const sb = browserWorld();
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: {} }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/browser",
      { companyId: COMPANY_ID, method: "POST", body: { conversation_id: CONVERSATION } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      from: "+16135550100",
      to: "+16135551000",
      client_state: btoa("oc_customer|+16135551000"),
    });
    // The server never dials — the browser does.
    expect(dial.calls).toHaveLength(0);
  });

  it("402s a non-active subscription", async () => {
    const sb = browserWorld({ subscriptionStatus: "canceled" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/browser",
      { companyId: COMPANY_ID, method: "POST", body: { conversation_id: CONVERSATION } },
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "subscription_inactive" },
    });
  });

  it("402s at the voice spending cap — never authorizes", async () => {
    const sb = browserWorld({ voiceSeconds: 7500 * 60 }); // 2,500 × 3
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/browser",
      { companyId: COMPANY_ID, method: "POST", body: { conversation_id: CONVERSATION } },
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "usage_cap_reached" },
    });
  });

  it("409s while ANY call on this NUMBER is in flight (line model — one live call per line)", async () => {
    const sb = browserWorld({ inflight: [{ id: "call-live-1" }] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/browser",
      { companyId: COMPANY_ID, method: "POST", body: { conversation_id: CONVERSATION } },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("on another call") },
    });
  });
});
