/**
 * D43 phase 3 — POST /v1/calls/live/* (transfer + consult orchestration).
 * Real product code over the stubbed network edge (D13). The engine's
 * webhook side is covered in messaging/live-call.test.ts; these tests pin
 * the ROUTE contracts: authorization (company scope, live-and-answered,
 * #106), the Telnyx commands issued, and the honest refusals.
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
import { liveCallsRoutes } from "./live-calls";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TARGET_ID = "1e2d3c4b-5a69-4788-9695-a4b3c2d1e0f9";
const NUMBER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const SESSION = "sess-live-9";
const CUSTOMER_CCID = "cust-ccid-9";

let auth: TestAuth;
const app = buildTestApp(liveCallsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function liveWorld(opts: {
  role?: string;
  call?: Record<string, unknown> | null;
  consultLegs?: unknown[];
  credentials?: (call: { url: URL }) => unknown[];
}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, opts.role ?? "owner"),
  );
  // eligibleTarget reads select=role for a SPECIFIC user (sender or target).
  sb.on("GET", "/rest/v1/company_members", (call) =>
    call.url.searchParams.get("select") === "role"
      ? [{ role: "member" }]
      : undefined,
  );
  sb.on("GET", "/rest/v1/number_access", () => []);
  sb.on("GET", "/rest/v1/calls", () =>
    opts.call === null
      ? []
      : [
          {
            company_id: COMPANY_ID,
            phone_number_id: NUMBER_ID,
            conversation_id: "cccccccc-0000-4000-8000-000000000003",
            caller_e164: "+16135551000",
            customer_call_control_id: CUSTOMER_CCID,
            answered_at: "2026-07-12T00:00:00Z",
            outcome: null,
            ...(opts.call ?? {}),
          },
        ],
  );
  sb.on("GET", "/rest/v1/phone_numbers", () => [
    { number_e164: "+16135550100" },
  ]);
  sb.on("GET", "/rest/v1/member_telephony_credentials", (call) => {
    if (opts.credentials) return opts.credentials(call);
    return [{ user_id: TARGET_ID, sip_username: "gencred_target" }];
  });
  sb.on("GET", "/rest/v1/call_member_legs", () => opts.consultLegs ?? []);
  sb.on("POST", "/rest/v1/call_member_legs", () =>
    Response.json([], { status: 201 }),
  );
  sb.on("DELETE", "/rest/v1/call_member_legs", () =>
    new Response(null, { status: 204 }),
  );
  sb.on("PATCH", "/rest/v1/calls", () => new Response(null, { status: 204 }));
  sb.on("GET", "/rest/v1/conversation_events", () => []);
  sb.on("POST", "/rest/v1/conversation_events", () =>
    Response.json([], { status: 201 }),
  );
  return sb;
}

function telnyxTransfer(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/calls\/[^/]+\/actions\/transfer$/.test(url.pathname),
    () => ({ data: { result: "ok" } }),
  );
}

function telnyxDialAndActions(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      (url.pathname === "/v2/calls" ||
        /\/v2\/calls\/[^/]+\/actions\/(bridge|hangup)$/.test(url.pathname)),
    (call) =>
      call.url.pathname === "/v2/calls"
        ? { data: { call_control_id: `dial-${call.url.pathname.length}` } }
        : { data: { result: "ok" } },
  );
}

describe("POST /v1/calls/live/:id/transfer (D43 phase 3)", () => {
  it("issues the Telnyx transfer on the CUSTOMER leg with the brt tag and NO client_state", async () => {
    const sb = liveWorld({});
    const transfer = telnyxTransfer();
    stubFetch(jwksRoute(auth), sb.route, transfer.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/transfer`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(202);
    expect(transfer.calls).toHaveLength(1);
    expect(transfer.calls[0].url.pathname).toBe(
      `/v2/calls/${CUSTOMER_CCID}/actions/transfer`,
    );
    const body = transfer.calls[0].body as Record<string, unknown>;
    expect(body.to).toBe("sip:gencred_target@sip.telnyx.com");
    // The target sees the CUSTOMER (who they're getting).
    expect(body.from).toBe("+16135551000");
    // The customer leg keeps its bri billing anchor.
    expect(body.client_state).toBeUndefined();
    const state = atob(body.target_leg_client_state as string);
    expect(state).toBe(
      `brt|${SESSION}|${TARGET_ID}|${auth.subject}|0|+16135551000`,
    );
  });

  it("409s when the call isn't live (already ended)", async () => {
    const sb = liveWorld({ call: { outcome: "answered" } });
    const transfer = telnyxTransfer();
    stubFetch(jwksRoute(auth), sb.route, transfer.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/transfer`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(409);
    expect(transfer.calls).toHaveLength(0);
  });

  it("404s a session from another company (scoped read finds nothing)", async () => {
    const sb = liveWorld({ call: null });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/transfer`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(404);
  });

  it("409s a target without a credential (their browser can't ring)", async () => {
    const sb = liveWorld({ credentials: () => [] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/transfer`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/calls/live/:id/consult + complete (D43 phase 3)", () => {
  it("dials BOTH members' browsers (brc tags) and ledgers the legs", async () => {
    // Both the sender (the JWT subject) and target hold credentials.
    const sb = liveWorld({
      credentials: (call) => {
        const filter = call.url.searchParams.get("user_id") ?? "";
        if (filter.includes(TARGET_ID)) {
          return [{ user_id: TARGET_ID, sip_username: "gencred_target" }];
        }
        if (filter.includes(auth.subject)) {
          return [{ user_id: auth.subject, sip_username: "gencred_sender" }];
        }
        return [];
      },
    });
    const telnyx = telnyxDialAndActions();
    stubFetch(jwksRoute(auth), sb.route, telnyx.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(202);
    const dials = telnyx.calls.filter((c) => c.url.pathname === "/v2/calls");
    expect(dials).toHaveLength(2);
    const to = dials.map((d) => (d.body as { to: string }).to).sort();
    expect(to).toEqual([
      "sip:gencred_sender@sip.telnyx.com",
      "sip:gencred_target@sip.telnyx.com",
    ]);
    const ledger = sb.find("POST", "/rest/v1/call_member_legs");
    expect(ledger).toHaveLength(1);
    const rows = ledger[0].body as { kind: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "consult")).toBe(true);
  });

  it("409s a second consult while one is running", async () => {
    const sb = liveWorld({
      consultLegs: [
        { call_control_id: "brc-1", user_id: TARGET_ID, state: "ringing" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult`,
      {
        companyId: COMPANY_ID,
        method: "POST",
        body: { target_user_id: TARGET_ID },
      },
    );
    expect(res.status).toBe(409);
  });

  it("complete: bridge-steals the customer onto the TARGET's consult leg, hangs up the sender's, stamps + journals", async () => {
    const sb = liveWorld({
      consultLegs: [
        { call_control_id: "brc-target", user_id: TARGET_ID, state: "answered" },
        {
          call_control_id: "brc-sender",
          user_id: auth.subject,
          state: "answered",
        },
      ],
    });
    const telnyx = telnyxDialAndActions();
    stubFetch(jwksRoute(auth), sb.route, telnyx.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult/complete`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(200);
    const bridge = telnyx.calls.find((c) => c.url.pathname.endsWith("/bridge"));
    expect(bridge).toBeDefined();
    expect(bridge!.url.pathname).toBe("/v2/calls/brc-target/actions/bridge");
    expect(bridge!.body).toMatchObject({ call_control_id: CUSTOMER_CCID });
    const hangup = telnyx.calls.find((c) => c.url.pathname.endsWith("/hangup"));
    expect(hangup!.url.pathname).toBe("/v2/calls/brc-sender/actions/hangup");
    // Ownership + journey line.
    const stamp = sb.find("PATCH", "/rest/v1/calls");
    expect(
      stamp.some(
        (c) =>
          (c.body as Record<string, unknown>).answered_by_user_id === TARGET_ID,
      ),
    ).toBe(true);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(1);
  });

  it("complete: 409s while the consult isn't connected yet", async () => {
    const sb = liveWorld({
      consultLegs: [
        { call_control_id: "brc-target", user_id: TARGET_ID, state: "ringing" },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult/complete`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/calls/live/:id/ring-me (#135 push-to-wake, #137 scoped cancel)", () => {
  it("rings the requester's browser and cancels ONLY their own stale ring leg (scoped by user_id)", async () => {
    // Still ringing (no one answered yet) — the whole point of ring-me.
    const sb = liveWorld({
      call: { answered_at: null, outcome: null },
      // A stale suspended-tab leg belonging to the REQUESTER themselves.
      consultLegs: [
        { call_control_id: "stale-self", user_id: auth.subject, state: "ringing" },
      ],
    });
    const telnyx = telnyxDialAndActions();
    stubFetch(jwksRoute(auth), sb.route, telnyx.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/ring-me`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(200);

    // #137: the pre-dial cancel MUST be scoped to the requesting member — it
    // filters on user_id, so waking one member never silences the rest of the
    // crew's still-ringing browsers.
    const cancelReads = sb.find("GET", "/rest/v1/call_member_legs");
    expect(cancelReads).toHaveLength(1);
    expect(cancelReads[0].url.searchParams.get("user_id")).toBe(
      `eq.${auth.subject}`,
    );
    expect(cancelReads[0].url.searchParams.get("state")).toBe("eq.ringing");

    // Exactly the requester's own stale leg is hung up — not a team-wide sweep.
    const hangups = telnyx.calls.filter((c) =>
      c.url.pathname.endsWith("/hangup"),
    );
    expect(hangups).toHaveLength(1);
    expect(hangups[0].url.pathname).toBe("/v2/calls/stale-self/actions/hangup");

    // A fresh dial to the requester's browser + a ledgered leg.
    const dials = telnyx.calls.filter((c) => c.url.pathname === "/v2/calls");
    expect(dials).toHaveLength(1);
    expect((dials[0].body as { to: string }).to).toBe(
      "sip:gencred_target@sip.telnyx.com",
    );
    expect(sb.find("POST", "/rest/v1/call_member_legs")).toHaveLength(1);
  });

  it("409s when the call has already been answered (not ringing anymore)", async () => {
    const sb = liveWorld({}); // default call has answered_at set
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/ring-me`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(409);
  });

  it("404s a session from another company (scoped read finds nothing)", async () => {
    const sb = liveWorld({ call: null });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/ring-me`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(404);
  });
});
