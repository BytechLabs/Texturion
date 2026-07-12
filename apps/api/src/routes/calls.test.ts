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

  it("D38 POST /calls: dials the member's cell from the business number and pre-creates the session", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      // The company-context membership read AND the call-cell read share the
      // table; answer both shapes.
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) {
        return [
          {
            call_cell_e164: "+16135557777",
            call_cell_verified_at: "2026-07-10T00:00:00Z", // D40: verified
          },
        ];
      }
      return membershipResponder(MEMBER_ID, "owner")(call);
    });
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 0);
    sb.on("GET", "/rest/v1/calls", () => []); // #133: no in-flight session
    sb.on("POST", "/rest/v1/rpc/api_claim_outbound_dial", () => true);
    sb.on(
      "DELETE",
      "/rest/v1/outbound_dial_leases",
      () => new Response(null, { status: 204 }),
    );
    sb.on("POST", "/rest/v1/rpc/api_upsert_call", () => ({
      id: "call-row-1",
      outcome: null,
    }));
    sb.on("PATCH", "/rest/v1/calls", () => [{ id: "call-row-1" }]);
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: { call_session_id: "sess-out-1", call_control_id: "cc-1" } }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      status: "dialing",
      call_session_id: "sess-out-1",
    });

    // The agent leg: business number → the member's cell, AMD on, tagged.
    expect(dial.calls).toHaveLength(1);
    expect(dial.calls[0].body).toMatchObject({
      to: "+16135557777",
      from: "+16135550100",
      answering_machine_detection: "detect",
      client_state: btoa("oc_agent|+16135551000"),
    });
    // The session pre-creates as outbound and links the conversation.
    const upsert = sb.find("POST", "/rest/v1/rpc/api_upsert_call")[0];
    expect(upsert.body).toMatchObject({
      p_call_session_id: "sess-out-1",
      p_caller_e164: "+16135551000",
      p_direction: "outbound",
    });
    expect(sb.find("PATCH", "/rest/v1/calls")).toHaveLength(1);
  });

  it("D38 POST /calls: 409 until the member sets their cell", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) return [{ call_cell_e164: null }];
      return membershipResponder(MEMBER_ID, "owner")(call);
    });
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 0);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("cell number") },
    });
  });

  it("D38 POST /calls: 402 usage_cap_reached at the voice spending cap — never dials", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "owner"),
    );
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    // Exactly at 2,500 × 3 = 7,500 minutes.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 7500 * 60);
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: {} }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "usage_cap_reached" },
    });
    expect(dial.calls).toHaveLength(0);
  });

  it("D38 PUT /calls/cell rejects garbage numbers", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const bad = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: "5551234" },
    });
    expect(bad.status).toBe(422);
  });

  it("D40 POST /calls: 409 while the cell is set but UNVERIFIED — never dials", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) {
        return [
          { call_cell_e164: "+16135557777", call_cell_verified_at: null },
        ];
      }
      return membershipResponder(MEMBER_ID, "owner")(call);
    });
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 0);
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: {} }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("Confirm your cell") },
    });
    expect(dial.calls).toHaveLength(0);
  });

  it("#133 POST /calls: 409 while an outbound session for this conversation is in flight", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) {
        return [
          {
            call_cell_e164: "+16135557777",
            call_cell_verified_at: "2026-07-10T00:00:00Z",
          },
        ];
      }
      return membershipResponder(MEMBER_ID, "owner")(call);
    });
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 0);
    sb.on("GET", "/rest/v1/calls", () => [{ id: "call-live-1" }]); // in flight
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: {} }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("already in progress") },
    });
    expect(dial.calls).toHaveLength(0);
  });

  it("#133 POST /calls: a lost dial claim is 409 — the atomic lease closes the race", async () => {
    const CONVERSATION = "cccccccc-0000-4000-8000-000000000003";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) {
        return [
          {
            call_cell_e164: "+16135557777",
            call_cell_verified_at: "2026-07-10T00:00:00Z",
          },
        ];
      }
      return membershipResponder(MEMBER_ID, "owner")(call);
    });
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
        subscription_status: "active",
      },
    ]);
    // #134/D42: NO company_modules stub — neither the (retired) module gate
    // nor companyOverVoiceCap reads it anymore; a read would fail loudly.
    sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => 0);
    sb.on("GET", "/rest/v1/calls", () => []);
    sb.on("POST", "/rest/v1/rpc/api_claim_outbound_dial", () => false);
    const dial: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/calls",
      () => ({ data: {} }),
    );
    stubFetch(jwksRoute(auth), sb.route, dial.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("already being started") },
    });
    expect(dial.calls).toHaveLength(0);
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
describe("D40 /v1/calls/cell verification", () => {
  const CELL = "+16135557777";

  async function codeHash(code: string): Promise<string> {
    // Mirrors the route: the CELL is in the preimage (#133 review — a code
    // can only verify the number it was texted to).
    const bytes = new TextEncoder().encode(
      `${COMPANY_ID}:${auth.subject}:${CELL}:${code}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  interface CellState {
    call_cell_e164?: string | null;
    call_cell_verified_at?: string | null;
    call_cell_code_hash?: string | null;
    call_cell_code_expires_at?: string | null;
    call_cell_code_attempts?: number;
    call_cell_code_sent_at?: string | null;
    call_cell_code_window_start?: string | null;
    call_cell_code_window_sends?: number;
  }

  function cellWorld(
    state: CellState = {},
    opts: { optedOut?: boolean; patchResult?: unknown[] } = {},
  ): {
    sb: SupabaseStub;
    sms: Stub;
    patches: () => Record<string, unknown>[];
  } {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      const select = call.url.searchParams.get("select") ?? "";
      if (select.includes("call_cell_e164")) {
        return [
          {
            call_cell_e164: state.call_cell_e164 ?? null,
            call_cell_verified_at: state.call_cell_verified_at ?? null,
            call_cell_code_hash: state.call_cell_code_hash ?? null,
            call_cell_code_expires_at: state.call_cell_code_expires_at ?? null,
            call_cell_code_attempts: state.call_cell_code_attempts ?? 0,
            call_cell_code_sent_at: state.call_cell_code_sent_at ?? null,
            call_cell_code_window_start:
              state.call_cell_code_window_start ?? null,
            call_cell_code_window_sends:
              state.call_cell_code_window_sends ?? 0,
          },
        ];
      }
      return membershipResponder(MEMBER_ID, "member")(call);
    });
    sb.on(
      "PATCH",
      "/rest/v1/company_members",
      () => opts.patchResult ?? [{ id: "cm-1" }],
    );
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      { number_e164: "+16135550100" },
    ]);
    // runPreSendGates: subscription + destination gates (CA cell → no 10DLC).
    sb.on("GET", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme",
        country: "CA",
        us_texting_enabled: true,
        subscription_status: "active",
      },
    ]);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () =>
      opts.optedOut ? [{ id: "opt-1" }] : [],
    );
    const sms: Stub = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () => ({ data: { id: "msg-code-1" } }),
    );
    return {
      sb,
      sms,
      patches: () =>
        sb.find("PATCH", "/rest/v1/company_members").map(
          (call) => call.body as Record<string, unknown>,
        ),
    };
  }

  it("PUT a new cell: persists unverified state, then texts a 6-digit code from the business number", async () => {
    const world = cellWorld();
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: CELL },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      call_cell_e164: CELL,
      verified: false,
      code_sent: true,
    });

    // Persisted BEFORE the send, scoped to self, verification cleared.
    const patch = world.patches()[0];
    expect(patch).toMatchObject({
      call_cell_e164: CELL,
      call_cell_verified_at: null,
      call_cell_code_attempts: 0,
      call_cell_code_window_sends: 1,
    });
    expect(patch.call_cell_code_hash).toEqual(expect.any(String));

    // The SMS: from the business number, to the cell, carrying the code.
    expect(world.sms.calls).toHaveLength(1);
    const smsBody = world.sms.calls[0].body as {
      from: string;
      to: string;
      text: string;
    };
    expect(smsBody.from).toBe("+16135550100");
    expect(smsBody.to).toBe(CELL);
    const code = /\b(\d{6})\b/.exec(smsBody.text)?.[1];
    expect(code).toBeTruthy();
    // The persisted hash matches the code that was texted.
    expect(patch.call_cell_code_hash).toBe(await codeHash(code as string));
  });

  it("PUT the already-verified number is a no-op (no code burned)", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_verified_at: "2026-07-10T00:00:00Z",
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: CELL },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      call_cell_e164: CELL,
      verified: true,
      code_sent: false,
    });
    expect(world.sms.calls).toHaveLength(0);
    expect(world.patches()).toHaveLength(0);
  });

  it("cooldown: a resend within a minute of the last code is 429", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_sent_at: new Date(Date.now() - 20_000).toISOString(),
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: CELL },
    });
    expect(res.status).toBe(429);
    expect(world.sms.calls).toHaveLength(0);
  });

  it("window budget: the 7th code in 24h is refused (cost protection)", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_sent_at: new Date(Date.now() - 120_000).toISOString(),
      call_cell_code_window_start: new Date(
        Date.now() - 3_600_000,
      ).toISOString(),
      call_cell_code_window_sends: 6,
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: CELL },
    });
    expect(res.status).toBe(409);
    expect(world.sms.calls).toHaveLength(0);
  });

  it("an opted-out cell is refused with the START instruction, never texted", async () => {
    const world = cellWorld({}, { optedOut: true });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: CELL },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("START") },
    });
    expect(world.sms.calls).toHaveLength(0);
  });

  it("verify: the right code marks verified and clears the pending state", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_hash: await codeHash("123456"),
      call_cell_code_expires_at: new Date(Date.now() + 300_000).toISOString(),
      call_cell_code_attempts: 0,
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/cell/verify",
      { companyId: COMPANY_ID, method: "POST", body: { code: "123456" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ call_cell_e164: CELL, verified: true });

    // Attempt consumed (guarded), then verified_at stamped + code cleared.
    const patches = world.patches();
    expect(patches[0]).toMatchObject({ call_cell_code_attempts: 1 });
    expect(patches[1]).toMatchObject({
      call_cell_verified_at: expect.any(String),
      call_cell_code_hash: null,
    });
  });

  it("verify: a wrong code is 422 and consumes an attempt", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_hash: await codeHash("123456"),
      call_cell_code_expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/cell/verify",
      { companyId: COMPANY_ID, method: "POST", body: { code: "000000" } },
    );
    expect(res.status).toBe(422);
    expect(world.patches()[0]).toMatchObject({ call_cell_code_attempts: 1 });
  });

  it("verify: the attempt cap refuses further tries (guarded increment misses)", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_hash: await codeHash("123456"),
      call_cell_code_expires_at: new Date(Date.now() + 300_000).toISOString(),
      call_cell_code_attempts: 5,
      // The guarded increment (.lt attempts cap) matches no row at the cap.
    }, { patchResult: [] });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/cell/verify",
      { companyId: COMPANY_ID, method: "POST", body: { code: "123456" } },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("Too many tries") },
    });
  });

  it("verify: an expired code is 409 even when it matches", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_code_hash: await codeHash("123456"),
      call_cell_code_expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls/cell/verify",
      { companyId: COMPANY_ID, method: "POST", body: { code: "123456" } },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("expired") },
    });
  });

  it("PUT null clears the cell AND the verification state", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_verified_at: "2026-07-10T00:00:00Z",
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { call_cell_e164: null },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      call_cell_e164: null,
      verified: false,
      code_sent: false,
    });
    expect(world.patches()[0]).toMatchObject({
      call_cell_e164: null,
      call_cell_verified_at: null,
      call_cell_code_hash: null,
    });
  });

  it("GET reports the verified flag", async () => {
    const world = cellWorld({
      call_cell_e164: CELL,
      call_cell_verified_at: "2026-07-10T00:00:00Z",
    });
    stubFetch(jwksRoute(auth), world.sb.route, world.sms.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/cell", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ call_cell_e164: CELL, verified: true });
  });
});

/**
 * D43 (#135) POST /v1/calls/browser — authorize a softphone-placed call. The
 * server never dials; it runs the outbound gates + line-busy guard and hands
 * back the number to present, the number to dial, and the oc_customer tag the
 * client stamps so the PSTN leg records through the D38 out_customer path.
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

  it("409s while a call for this conversation is in flight (line model)", async () => {
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
      error: { message: expect.stringContaining("already in progress") },
    });
  });
});
