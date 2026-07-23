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
import type { Env } from "../env";
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
            direction: "inbound",
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
    // CALLS-CLIENT-V2 §3.2 (#208): the transfer's NEW member leg carries the
    // session-correlation custom SIP header (exactly like ring legs) so the
    // target's client correlates the INVITE deterministically.
    expect(
      (body as { custom_headers: { name: string; value: string }[] })
        .custom_headers,
    ).toEqual([{ name: "X-Loonext-Session", value: SESSION }]);
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
    // CALLS-CLIENT-V2 §3.2 (#208): both consult legs carry the session-
    // correlation custom SIP header, exactly like ring legs.
    for (const dial of dials) {
      expect(
        (dial.body as { custom_headers: { name: string; value: string }[] })
          .custom_headers,
      ).toEqual([{ name: "X-Loonext-Session", value: SESSION }]);
    }
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

  /** #208: a CALL_SESSIONS namespace recording setOwner/clearIntent into a
   *  shared ops log, so DO-vs-Telnyx ordering is assertable. */
  function recordingSessions(ops: string[]): Env["CALL_SESSIONS"] {
    return {
      idFromName: (name: string) => name,
      get: () => ({
        setOwner: async (input: { sessionId: string; userId: string }) => {
          ops.push(`setOwner:${input.userId}`);
        },
        clearIntent: async () => {
          ops.push("clearIntent");
        },
      }),
    } as unknown as Env["CALL_SESSIONS"];
  }

  it("complete (#208): the DO owner stamp (setOwner then clearIntent) lands BEFORE the bridge-steal", async () => {
    // Ordering is the crash-window fix: a crash between the steal and a
    // post-steal DO stamp would leave the machine believing the SENDER still
    // owns the call, and the re-armed intent expiry would force-hang the
    // transferred customer.
    const ops: string[] = [];
    const doEnv: Env = { ...env, CALL_SESSIONS: recordingSessions(ops) };
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
    const telnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/(bridge|hangup)$/.test(url.pathname),
      (call) => {
        if (call.url.pathname.endsWith("/bridge")) ops.push("bridge");
        return { data: { result: "ok" } };
      },
    );
    stubFetch(jwksRoute(auth), sb.route, telnyx.route);

    const res = await apiRequest(
      app,
      doEnv,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult/complete`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(200);
    expect(ops).toEqual([`setOwner:${TARGET_ID}`, "clearIntent", "bridge"]);
  });

  it("complete (#208): a FAILED bridge-steal restores the SENDER as the machine owner too", async () => {
    const ops: string[] = [];
    const doEnv: Env = { ...env, CALL_SESSIONS: recordingSessions(ops) };
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
    const bridge = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/bridge$/.test(url.pathname),
      () => Response.json({ errors: [{ title: "call gone" }] }, { status: 422 }),
    );
    stubFetch(jwksRoute(auth), sb.route, bridge.route);

    const res = await apiRequest(
      app,
      doEnv,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult/complete`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(500);
    // The pre-steal hand-off happened, then the failure handed it back.
    expect(ops).toEqual([
      `setOwner:${TARGET_ID}`,
      "clearIntent",
      `setOwner:${auth.subject}`,
    ]);
  });

  it("complete (#168 ordering): stamps the new owner BEFORE the bridge-steal, and RESTORES the sender when the bridge fails", async () => {
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
    // The bridge-steal FAILS (the customer leg just died).
    const bridge = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/bridge$/.test(url.pathname),
      () => Response.json({ errors: [{ title: "call gone" }] }, { status: 422 }),
    );
    stubFetch(jwksRoute(auth), sb.route, bridge.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/consult/complete`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(500);

    // The pre-bridge stamp happened (so the sender's ring-leg death handler
    // sees the hand-off and never tears the stolen customer down)…
    const stamps = sb
      .find("PATCH", "/rest/v1/calls")
      .map((c) => (c.body as Record<string, unknown>).answered_by_user_id);
    expect(stamps[0]).toBe(TARGET_ID);
    // …and the failed bridge restored the sender as owner.
    expect(stamps[1]).toBe(auth.subject);
    // The failure aborted the choreography: ledger rows kept, no sender hangup.
    expect(sb.find("DELETE", "/rest/v1/call_member_legs")).toHaveLength(0);
  });
});

describe("GET /v1/calls/live/mine (#168 part D — post-crash recovery)", () => {
  const LIVE_ROW = {
    call_session_id: SESSION,
    caller_e164: "+16135551000",
    caller_name: "ACME CUSTOMER",
    contact_id: null,
    conversation_id: "cccccccc-0000-4000-8000-000000000003",
    phone_number_id: NUMBER_ID,
    direction: "inbound",
    started_at: "2026-07-16T00:00:00Z",
    answered_at: "2026-07-16T00:00:07Z",
  };

  /** Minimal world: membership + the mine read (+ #106 rules for members). */
  function mineWorld(opts: {
    role?: string;
    rows?: Record<string, unknown>[];
    accessRules?: unknown[];
  }): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, opts.role ?? "owner"),
    );
    sb.on("GET", "/rest/v1/calls", () => opts.rows ?? []);
    sb.on("GET", "/rest/v1/number_access", () => opts.accessRules ?? []);
    return sb;
  }

  it("returns the member's live answered sessions with the recovery facts, scoped in SQL to mine + live", async () => {
    const sb = mineWorld({ rows: [LIVE_ROW] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/live/mine", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { calls: Record<string, unknown>[] };
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({
      call_session_id: SESSION,
      caller_e164: "+16135551000",
      caller_name: "ACME CUSTOMER",
      conversation_id: "cccccccc-0000-4000-8000-000000000003",
      phone_number_id: NUMBER_ID,
      direction: "inbound",
      started_at: "2026-07-16T00:00:00Z",
      answered_at: "2026-07-16T00:00:07Z",
    });

    // The liveness contract is enforced IN the query: my answered, un-ended
    // calls only, company-scoped, inside the stale-call window.
    const read = sb.find("GET", "/rest/v1/calls")[0];
    expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(read.url.searchParams.get("answered_by_user_id")).toBe(
      `eq.${auth.subject}`,
    );
    expect(read.url.searchParams.get("outcome")).toBe("is.null");
    expect(read.url.searchParams.get("answered_at")).toBe("not.is.null");
    expect(read.url.searchParams.get("created_at")).toMatch(/^gte\./);
  });

  it("#106: a call on a number HIDDEN from the member never enumerates", async () => {
    const sb = mineWorld({
      role: "member",
      rows: [LIVE_ROW],
      // The number is ruled for someone else — this member resolves 'none'.
      accessRules: [
        {
          phone_number_id: NUMBER_ID,
          principal_kind: "user",
          principal: TARGET_ID,
          level: "text",
        },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/live/mine", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { calls: unknown[] }).calls).toHaveLength(0);
  });

  it("returns an empty list when no call is live (the relaunch found nothing to recover)", async () => {
    const sb = mineWorld({});
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/live/mine", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { calls: unknown[] }).calls).toHaveLength(0);
  });
});

describe("POST /v1/calls/live/:id/ring-me (#135 push-to-wake, #137 scoped cancel)", () => {
  it("v3: routes to the DO's ringMe and returns its truthful body", async () => {
    // Still ringing (no one answered yet) — the whole point of ring-me. The DO
    // owns sequencing/state; the route just wires the requester's eligible
    // credential into DO.ringMe and echoes its reply (§6). ring-me NEVER cancels
    // a leg, so there are no ledger sweeps or dials on the route side anymore.
    const sb = liveWorld({ call: { answered_at: null, outcome: null } });
    const captured: {
      sessionId: string;
      userId: string;
      sipUsername: string;
      noLocalLeg: boolean;
    }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: {
        idFromName: (name: string) => name,
        get: () => ({
          ringMe: async (input: {
            sessionId: string;
            userId: string;
            sipUsername: string;
            noLocalLeg: boolean;
          }) => {
            captured.push(input);
            return { rang: true, state: "ringing" };
          },
        }),
      } as unknown as Env["CALL_SESSIONS"],
    };
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      doEnv,
      await auth.token(),
      `/v1/calls/live/${SESSION}/ring-me`,
      { companyId: COMPANY_ID, method: "POST", body: { no_local_leg: true } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rang: true, state: "ringing" });
    // Routed into THIS member's DO leg with the v2 no_local_leg attestation.
    expect(captured).toEqual([
      {
        sessionId: SESSION,
        userId: auth.subject,
        sipUsername: "gencred_target",
        noLocalLeg: true,
      },
    ]);
  });

  it("409s a still-ringing OUTBOUND call and fires NO dial (#139 direction gate)", async () => {
    // A teammate's in-flight outbound call: outcome + answered_at both null,
    // both ccids set — it would pass every other gate. Only direction stops it.
    const sb = liveWorld({
      call: { answered_at: null, outcome: null, direction: "outbound" },
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
    expect(res.status).toBe(409);
    // No spurious billable dial and no ledgered leg onto the outbound line.
    expect(telnyx.calls.filter((c) => c.url.pathname === "/v2/calls")).toHaveLength(
      0,
    );
    expect(sb.find("POST", "/rest/v1/call_member_legs")).toHaveLength(0);
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

describe("POST /v1/calls/live/:id/decline (#171)", () => {
  async function post(sb: SupabaseStub) {
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calls/live/${SESSION}/decline`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
  }

  it("a still-ringing call → 200 {declined:false} in the no-binding env (v3-only signal)", async () => {
    // No CALL_SESSIONS binding in the test env → the fallback owns the reply.
    const sb = liveWorld({ call: { answered_at: null, outcome: null } });
    const res = await post(sb);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { declined: boolean; state: string; reason?: string };
    expect(body).toMatchObject({ declined: false, reason: "not_ringing" });
    expect(body.state).toBe("ringing");
  });

  it("never a 409 for state: declining an already-ENDED call is a 200 no-op body", async () => {
    const sb = liveWorld({ call: { answered_at: null, outcome: "missed" } });
    const res = await post(sb);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { declined: boolean; state: string };
    expect(body).toMatchObject({ declined: false, state: "ended_missed" });
  });

  it("404s a session from another company (scoped read finds nothing)", async () => {
    const sb = liveWorld({ call: null });
    const res = await post(sb);
    expect(res.status).toBe(404);
  });

  it("409s an OUTBOUND call (decline is inbound-only, mirrors #139)", async () => {
    const sb = liveWorld({ call: { answered_at: null, outcome: null, direction: "outbound" } });
    const res = await post(sb);
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/calls/live/decline-mine (#171 R1)", () => {
  interface DeclineReply {
    declined: boolean;
    state: string;
    reason?: string;
  }

  /** A CALL_SESSIONS namespace whose per-session decline is scripted. Records
   *  every {sessionId,userId} the route routes into a DO.decline. */
  function fakeSessions(
    perSession: Record<string, DeclineReply>,
    routed: { sessionId: string; userId: string }[],
  ): Env["CALL_SESSIONS"] {
    return {
      idFromName: (name: string) => name,
      get: (_id: string) => ({
        decline: async (input: { sessionId: string; userId: string }) => {
          routed.push({ sessionId: input.sessionId, userId: input.userId });
          return (
            perSession[input.sessionId] ?? {
              declined: false,
              state: "ended_missed",
              reason: "not_ringing",
            }
          );
        },
      }),
    } as unknown as Env["CALL_SESSIONS"];
  }

  /** Membership (for requireRole) + the company ringing-sessions read. */
  function world(rows: { call_session_id: string }[]): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calls", () => rows);
    return sb;
  }

  async function post(env2: Env, sb: SupabaseStub) {
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(app, env2, await auth.token(), "/v1/calls/live/decline-mine", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
  }

  it("declines the one session ringing me (solo → the DO resolves to voicemail)", async () => {
    const routed: { sessionId: string; userId: string }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: fakeSessions(
        { [SESSION]: { declined: true, state: "voicemail_greeting" } },
        routed,
      ),
    };
    const sb = world([{ call_session_id: SESSION }]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      declined: boolean;
      sessions: { session_id: string; state: string }[];
    };
    expect(body.declined).toBe(true);
    expect(body.sessions).toEqual([
      { session_id: SESSION, state: "voicemail_greeting" },
    ]);
    // Routed into the DO for THIS member (auth.subject), not MEMBER_ID.
    expect(routed).toEqual([{ sessionId: SESSION, userId: auth.subject }]);

    // The queryable truth: company-scoped, state='ringing', outcome null.
    const read = sb.find("GET", "/rest/v1/calls")[0];
    expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(read.url.searchParams.get("state")).toBe("eq.ringing");
    expect(read.url.searchParams.get("outcome")).toBe("is.null");
  });

  it("a ringing session NOT targeting me → declined:false, not listed, no leak of the other session", async () => {
    // Two company sessions ring at once; only OTHER targets me — the DO no-ops
    // (declined:false) for the session I'm not a target of, and the route never
    // enumerates it in the body (#106 / #171 no-leak).
    const OTHER = "sess-not-mine";
    const routed: { sessionId: string; userId: string }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: fakeSessions(
        {
          [OTHER]: { declined: false, state: "ringing", reason: "not_ringing" },
        },
        routed,
      ),
    };
    const sb = world([{ call_session_id: OTHER }]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      declined: boolean;
      sessions: unknown[];
    };
    expect(body).toEqual({ declined: false, sessions: [] });
    // It DID route the no-op decline (the DO is the authority on membership)…
    expect(routed).toEqual([{ sessionId: OTHER, userId: auth.subject }]);
  });

  it("lists ONLY the session I was a target of when several company sessions ring", async () => {
    const MINE = "sess-mine";
    const THEIRS = "sess-theirs";
    const routed: { sessionId: string; userId: string }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: fakeSessions(
        {
          [MINE]: { declined: true, state: "voicemail_greeting" },
          [THEIRS]: { declined: false, state: "ringing", reason: "not_ringing" },
        },
        routed,
      ),
    };
    const sb = world([
      { call_session_id: MINE },
      { call_session_id: THEIRS },
    ]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      declined: boolean;
      sessions: { session_id: string }[];
    };
    expect(body.declined).toBe(true);
    expect(body.sessions).toEqual([
      { session_id: MINE, state: "voicemail_greeting" },
    ]);
  });

  it("no ringing sessions → 200 {declined:false, sessions:[]} and no DO call", async () => {
    const routed: { sessionId: string; userId: string }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: fakeSessions({}, routed),
    };
    const sb = world([]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ declined: false, sessions: [] });
    expect(routed).toHaveLength(0);
  });

  it("idempotent repeat: a second decline of the same session is a 200 no-op body", async () => {
    // The DO is idempotent — after the first decline the session is resolved, so
    // the repeat returns declined:false.
    const routed: { sessionId: string; userId: string }[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: fakeSessions(
        { [SESSION]: { declined: false, state: "ended_voicemail", reason: "not_ringing" } },
        routed,
      ),
    };
    const sb = world([{ call_session_id: SESSION }]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ declined: false, sessions: [] });
  });

  it("a per-session DO throw is swallowed: still 200, batch survives", async () => {
    const GOOD = "sess-good";
    const BAD = "sess-bad";
    const routed: { sessionId: string; userId: string }[] = [];
    const namespace = {
      idFromName: (name: string) => name,
      get: (_id: string) => ({
        decline: async (input: { sessionId: string; userId: string }) => {
          routed.push({ sessionId: input.sessionId, userId: input.userId });
          if (input.sessionId === BAD) throw new Error("DO RPC exploded");
          return { declined: true, state: "voicemail_greeting" };
        },
      }),
    } as unknown as Env["CALL_SESSIONS"];
    const doEnv: Env = { ...env, CALL_SESSIONS: namespace };
    // BAD is newest (ordered desc), then GOOD — the throw on BAD must not stop GOOD.
    const sb = world([{ call_session_id: BAD }, { call_session_id: GOOD }]);
    const res = await post(doEnv, sb);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      declined: boolean;
      sessions: { session_id: string }[];
    };
    expect(body.declined).toBe(true);
    expect(body.sessions).toEqual([
      { session_id: GOOD, state: "voicemail_greeting" },
    ]);
    expect(routed).toHaveLength(2); // both attempted
  });
});
