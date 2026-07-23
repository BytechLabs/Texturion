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
      p_contact_id: null, // #205: absent param = unfiltered, unchanged shape
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

  it("narrows on ?contact_id= (#205) and rejects a non-uuid value", async () => {
    const contactId = "dddddddd-0000-4000-8000-000000000004";
    const sb = callsStub([callRow({ contact_id: contactId })]);
    stubFetch(jwksRoute(auth), sb.route);

    const ok = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls?contact_id=${contactId}`,
      { companyId: COMPANY_ID },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { contact_id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].contact_id).toBe(contactId);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calls")[0].body,
    ).toMatchObject({ p_contact_id: contactId });

    const bad = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calls?contact_id=not-a-uuid",
      { companyId: COMPANY_ID },
    );
    expect(bad.status).toBe(422);
  });

  it("composes ?contact_id= with ?outcome= (#205): both reach the SQL", async () => {
    const contactId = "dddddddd-0000-4000-8000-000000000004";
    const sb = callsStub([]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls?contact_id=${contactId}&outcome=missed`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calls")[0].body,
    ).toMatchObject({ p_contact_id: contactId, p_outcome: "missed" });
  });

  it("still passes the #106 deny list alongside ?contact_id= (#205)", async () => {
    const contactId = "dddddddd-0000-4000-8000-000000000004";
    const sb = callsStub([], {
      accessRules: [
        { user_id: MEMBER_ID, phone_number_id: HIDDEN_NUMBER, level: "none" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls?contact_id=${contactId}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calls")[0].body,
    ).toMatchObject({
      p_contact_id: contactId,
      p_hidden_number_ids: [HIDDEN_NUMBER],
    });
  });

  it("keeps keyset pagination with ?contact_id= (#205): the cursor round-trips", async () => {
    const contactId = "dddddddd-0000-4000-8000-000000000004";
    const rows = [
      callRow({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        contact_id: contactId,
      }),
      callRow({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        contact_id: contactId,
        started_at: "2026-07-10T14:00:00+00:00",
      }),
    ];
    const sb = callsStub(rows);
    stubFetch(jwksRoute(auth), sb.route);

    const first = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls?contact_id=${contactId}&limit=1`,
      { companyId: COMPANY_ID },
    );
    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      data: unknown[];
      next_cursor: string | null;
    };
    expect(page.data).toHaveLength(1);
    expect(page.next_cursor).toEqual(expect.any(String));

    const second = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls?contact_id=${contactId}&limit=1&cursor=${encodeURIComponent(
        page.next_cursor as string,
      )}`,
      { companyId: COMPANY_ID },
    );
    expect(second.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_calls")[1];
    expect(rpc.body).toMatchObject({
      p_contact_id: contactId,
      p_cursor_ts: "2026-07-10T15:00:00+00:00",
      p_cursor_id: "aaaaaaaa-0000-4000-8000-000000000001",
    });
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

  const BUSINESS_NUMBER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
  const CONTACT_ID = "aaaaaaaa-0000-4000-8000-000000000009";

  function browserWorld(
    opts: {
      subscriptionStatus?: string;
      voiceSeconds?: number;
      inflight?: unknown[];
      lineBusy?: boolean;
      role?: string;
      /** Active numbers the company owns (contact/dialer number resolution). */
      numbers?: { id: string; number_e164: string }[];
      /** The stored number for a contact_id call. */
      contactPhone?: string | null;
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
        contact_id: CONTACT_ID,
        phone_number_id: BUSINESS_NUMBER_ID,
        contacts: { phone_e164: "+16135551000" },
        phone_numbers: { number_e164: "+16135550100", status: "active" },
      },
    ]);
    // Contact- and dialer-originated calls resolve the customer + the business
    // number from these two reads (the conversation path never hits them).
    sb.on("GET", "/rest/v1/contacts", () =>
      opts.contactPhone === null
        ? []
        : [{ phone_e164: opts.contactPhone ?? "+16135551000" }],
    );
    sb.on("GET", "/rest/v1/phone_numbers", () =>
      opts.numbers ?? [{ id: BUSINESS_NUMBER_ID, number_e164: "+16135550100" }],
    );
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
    // D43: the endpoint atomically claims the line + mints the single-use
    // authorization via api_claim_outbound_line (true = claimed, false = busy).
    sb.on(
      "POST",
      "/rest/v1/rpc/api_claim_outbound_line",
      () => !(opts.lineBusy ?? false),
    );
    return sb;
  }

  it("authorizes: mints a single-use auth + returns from/to and the oc_customer tag WITH the nonce — no Telnyx dial", async () => {
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
    const bodyOut = (await res.json()) as {
      from: string;
      to: string;
      client_state: string;
    };
    expect(bodyOut.from).toBe("+16135550100");
    expect(bodyOut.to).toBe("+16135551000");
    // client_state = base64("oc_customer|<customer>|<nonce>") — the nonce is
    // the webhook's single-use authorization.
    const decoded = atob(bodyOut.client_state).split("|");
    expect(decoded[0]).toBe("oc_customer");
    expect(decoded[1]).toBe("+16135551000");
    expect(decoded[2]).toBeTruthy(); // a nonce is present
    // The atomic line-claim RPC was called with that exact nonce + caller ID
    // (it reserves the line AND mints the authorization under one lock).
    const claim = sb.find("POST", "/rest/v1/rpc/api_claim_outbound_line");
    expect(claim).toHaveLength(1);
    expect(claim[0].body).toMatchObject({
      p_nonce: decoded[2],
      p_from: "+16135550100",
      p_customer: "+16135551000",
    });
    // The server never dials — the browser does.
    expect(dial.calls).toHaveLength(0);
  });

  it("#211: CALLS_OUTBOUND_V3 on → returns call_session_id (S), a 4-part tag, and stores S+placer on the claim", async () => {
    const sb = browserWorld();
    stubFetch(jwksRoute(auth), sb.route);
    // The gate is callsV3Active(env) && CALLS_OUTBOUND_V3 — both must hold.
    const v3env = {
      ...env,
      CALL_SESSIONS: { idFromName: () => ({}) },
      CALLS_OUTBOUND_V3: "1",
    } as unknown as typeof env;

    const res = await apiRequest(app, v3env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      client_state: string;
      call_session_id: string | null;
    };
    // The response carries S; the tag is 4-part with part-4 == S (the ONE id).
    expect(body.call_session_id).toBeTruthy();
    const parts = atob(body.client_state).split("|");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("oc_customer");
    expect(parts[3]).toBe(body.call_session_id);
    // The claim recorded S (=call_session_id) and the placing member.
    const claim = sb.find("POST", "/rest/v1/rpc/api_claim_outbound_line");
    expect(claim[0].body).toMatchObject({ p_call_session_id: body.call_session_id });
    expect((claim[0].body as { p_user_id?: string }).p_user_id).toBeTruthy();
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

  it("402s when live in-flight calls' reserved minutes push a near-cap tenant over (#144)", async () => {
    // Terminated usage alone is 60s UNDER the cap (2,500 × 3 = 450,000s), so
    // the old boundary check would authorize. Two already-live outbound calls
    // reserve 2 × 120s = 240s, projecting past the cap → refuse the fan-out.
    const sb = browserWorld({
      voiceSeconds: 7500 * 60 - 60,
      inflight: [{ id: "live-1" }, { id: "live-2" }],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "usage_cap_reached" },
    });
    // The atomic line claim is never reached — the cap refuses first.
    expect(sb.find("POST", "/rest/v1/rpc/api_claim_outbound_line")).toHaveLength(
      0,
    );
  });

  it("authorizes a near-cap tenant with NO live calls — the reserve only bites on concurrency (#144)", async () => {
    // Same 60s-under-cap usage, but no in-flight calls → reserve 0 → allowed.
    const sb = browserWorld({ voiceSeconds: 7500 * 60 - 60, inflight: [] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { conversation_id: CONVERSATION },
    });
    expect(res.status).toBe(200);
  });

  it("409s while ANY call on this NUMBER is in flight (line model — the atomic claim returns busy)", async () => {
    const sb = browserWorld({ lineBusy: true });
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

  it("calls a CONTACT with no thread yet (contact_id) — resolves the sole active number", async () => {
    const sb = browserWorld({ contactPhone: "+16475551234" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { contact_id: CONTACT_ID },
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { from: string; to: string };
    expect(out.from).toBe("+16135550100"); // the company's sole active number
    expect(out.to).toBe("+16475551234"); // the contact's stored number
    const claim = sb.find("POST", "/rest/v1/rpc/api_claim_outbound_line");
    expect(claim[0].body).toMatchObject({
      p_phone_number_id: BUSINESS_NUMBER_ID,
      p_from: "+16135550100",
      p_customer: "+16475551234",
    });
  });

  it("DIALS a raw number (dialer) — normalizes it and resolves the sole active number", async () => {
    const sb = browserWorld();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { to: "(418) 655-3839" }, // human-typed → normalized to +1418…
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { from: string; to: string };
    expect(out.from).toBe("+16135550100");
    expect(out.to).toBe("+14186553839");
  });

  it("422s an uncallable dialer number", async () => {
    const sb = browserWorld();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { to: "123" },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("asks which number to call from when the company owns several (no phone_number_id)", async () => {
    const sb = browserWorld({
      numbers: [
        { id: BUSINESS_NUMBER_ID, number_e164: "+16135550100" },
        { id: "bbbbbbbb-0000-4000-8000-000000000003", number_e164: "+14165550200" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { to: "+14186553839" },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("which of your numbers") },
    });
  });

  it("presents the chosen phone_number_id when the company owns several", async () => {
    const sb = browserWorld({
      numbers: [
        { id: BUSINESS_NUMBER_ID, number_e164: "+16135550100" },
        { id: "bbbbbbbb-0000-4000-8000-000000000003", number_e164: "+14165550200" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/browser", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {
        to: "+14186553839",
        phone_number_id: "bbbbbbbb-0000-4000-8000-000000000003",
      },
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { from: string };
    expect(out.from).toBe("+14165550200"); // the chosen number
  });
});
