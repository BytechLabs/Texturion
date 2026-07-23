/**
 * D43 phase 3 — the live-call engine, driven through handleCallEvent with
 * mocked Telnyx webhook events (the same edge the ring tests stub):
 *   - a transfer target ANSWER stamps the new owner + the journey line;
 *   - a MISSED transfer (timeout/decline) snaps the customer back to the
 *     sender (hop 0 → 1) and diverts to voicemail at the hop cap;
 *   - a normal end-of-call hangup of the transferee leg carries no verdict;
 *   - consult legs bridge when both answer, and a hangup dismisses the
 *     sibling — nobody is ever left listening to silence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { restMatch, stubRoute, type Stub } from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { buildConsultState, buildTransferState } from "./live-call";
import { handleCallEvent } from "./voice-webhook";
import type { TelnyxEvent } from "./types";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const CALLER = "+16135551000";
const SESSION = "sess-live-1";
const CUSTOMER_CCID = "cust-ccid-1";
const SENDER = "aaaaaaaa-0000-4000-8000-00000000000a";
const TARGET = "bbbbbbbb-0000-4000-8000-0000000000b0";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function event(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  return { data: { id: "evt-1", event_type: eventType, payload } };
}

/** The live calls-row read every handler starts from. */
function liveCallStub(overrides: Record<string, unknown> = {}): Stub {
  return stubRoute(restMatch(env, "GET", "calls"), () => [
    {
      company_id: COMPANY_ID,
      phone_number_id: NUMBER_ID,
      conversation_id: "conv-1",
      caller_e164: CALLER,
      customer_call_control_id: CUSTOMER_CCID,
      answered_at: "2026-07-12T00:00:00Z",
      outcome: null,
      ...overrides,
    },
  ]);
}

function callsPatch(): Stub {
  return stubRoute(
    restMatch(env, "PATCH", "calls"),
    () => new Response(null, { status: 204 }),
  );
}

function eventScan(existing: unknown[] = []): Stub {
  return stubRoute(restMatch(env, "GET", "conversation_events"), () => existing);
}

function eventInsert(): Stub {
  return stubRoute(restMatch(env, "POST", "conversation_events"), () =>
    Response.json([], { status: 201 }),
  );
}

function telnyxActions(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/calls\/[^/]+\/actions\/(transfer|bridge|hangup|answer|speak)$/.test(
        url.pathname,
      ),
    () => ({ data: { result: "ok" } }),
  );
}

describe("D43 phase 3 — transfer target legs (brt)", () => {
  const brtState = (hops: number) =>
    buildTransferState({
      sessionId: SESSION,
      targetUserId: TARGET,
      senderUserId: SENDER,
      hops,
      caller: CALLER,
    });

  // The ledgered transfer intent (kind='transfer') — the proof the answer
  // path checks before trusting the echoed brt tag. `claimed` rows drive the
  // guarded UPDATE .select() results.
  function transferLegPatch(claimed: unknown[]): Stub {
    return stubRoute(restMatch(env, "PATCH", "call_member_legs"), () =>
      claimed,
    );
  }

  it("answer: verifies the ledgered intent, stamps the new owner, drops the journey line", async () => {
    const claim = transferLegPatch([{ company_id: COMPANY_ID }]);
    const stamp = callsPatch();
    const scan = eventScan();
    const insert = eventInsert();
    serve(claim, liveCallStub(), stamp, scan, insert);

    await handleCallEvent(
      env,
      event("call.answered", {
        call_control_id: "brt-leg-1",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: brtState(0),
      }),
    );

    const owner = stamp.calls.find(
      (c) =>
        (c.body as Record<string, unknown> | null)?.answered_by_user_id ===
        TARGET,
    );
    expect(owner).toBeDefined();
    expect(insert.calls).toHaveLength(1);
    expect(insert.calls[0].body).toMatchObject({
      type: "call_completed",
      payload: {
        kind: "transferred",
        call_session_id: SESSION,
        from_user_id: SENDER,
        to_user_id: TARGET,
      },
    });
  });

  it("#208: a successful transfer answer hands the DO owner to the TARGET, then clears the intent, in that order", async () => {
    // The order is load-bearing: set-owner clears ownerLegDeadDuringIntent
    // (the sender's leg dying mid-transfer is the expected blind-transfer
    // shape); clearIntent FIRST would re-run T7's stood-down teardown against
    // the old owner and force-hang the transferred customer.
    const ops: string[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: {
        idFromName: (name: string) => name,
        get: () => ({
          setOwner: async (input: { sessionId: string; userId: string }) => {
            ops.push(`setOwner:${input.userId}`);
          },
          clearIntent: async () => {
            ops.push("clearIntent");
          },
        }),
      } as unknown as Env["CALL_SESSIONS"],
    };
    const claim = transferLegPatch([{ company_id: COMPANY_ID }]);
    serve(claim, liveCallStub(), callsPatch(), eventScan(), eventInsert());

    await handleCallEvent(
      doEnv,
      event("call.answered", {
        call_control_id: "brt-leg-1",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: brtState(0),
      }),
    );

    expect(ops).toEqual([`setOwner:${TARGET}`, "clearIntent"]);
  });

  it("#208: a FORGED/replayed brt answer (no claimed intent) never touches the DO", async () => {
    const ops: string[] = [];
    const doEnv: Env = {
      ...env,
      CALL_SESSIONS: {
        idFromName: (name: string) => name,
        get: () => ({
          setOwner: async () => {
            ops.push("setOwner");
          },
          clearIntent: async () => {
            ops.push("clearIntent");
          },
        }),
      } as unknown as Env["CALL_SESSIONS"],
    };
    const claim = transferLegPatch([]); // no ledgered intent for this session
    serve(claim, liveCallStub(), callsPatch(), eventInsert());

    await handleCallEvent(
      doEnv,
      event("call.answered", {
        call_control_id: "brt-forged",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: brtState(0),
      }),
    );

    expect(ops).toEqual([]);
  });

  it("answer: a FORGED brt with no ledgered intent is ignored (no stamp, no journey)", async () => {
    const claim = transferLegPatch([]); // no issued transfer for this session
    const stamp = callsPatch();
    const insert = eventInsert();
    serve(claim, liveCallStub(), stamp, insert);

    await handleCallEvent(
      env,
      event("call.answered", {
        call_control_id: "brt-forged",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: brtState(0),
      }),
    );

    expect(stamp.calls).toHaveLength(0);
    expect(insert.calls).toHaveLength(0);
  });

  it("missed at hop 0: SNAPS the customer BACK to the sender (hop 1; target sees the customer; no client_state on the customer leg)", async () => {
    const actions = telnyxActions();
    const close = transferLegPatch([{ call_control_id: "transfer:x:0" }]);
    const ledgerInsert = stubRoute(
      restMatch(env, "POST", "call_member_legs"),
      () => Response.json([], { status: 201 }),
    );
    const credential = stubRoute(
      restMatch(env, "GET", "member_telephony_credentials"),
      () => [{ sip_username: "gencred_sender" }],
    );
    serve(close, liveCallStub(), ledgerInsert, credential, actions);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "brt-leg-1",
        call_session_id: SESSION,
        direction: "outgoing",
        hangup_cause: "timeout",
        client_state: brtState(0),
      }),
    );

    const transfer = actions.calls.find((c) =>
      c.url.pathname.endsWith("/transfer"),
    );
    expect(transfer).toBeDefined();
    expect(transfer!.url.pathname).toBe(
      `/v2/calls/${CUSTOMER_CCID}/actions/transfer`,
    );
    const body = transfer!.body as Record<string, unknown>;
    expect(body.to).toBe("sip:gencred_sender@sip.telnyx.com");
    // The target sees the CUSTOMER (who they're getting), not the business #.
    expect(body.from).toBe(CALLER);
    // The customer leg keeps its bri billing anchor — never re-tagged.
    expect(body.client_state).toBeUndefined();
    const echoed = atob(body.target_leg_client_state as string);
    expect(echoed).toBe(`brt|${SESSION}|${SENDER}|${SENDER}|1|${CALLER}`);
  });

  it("missed at the hop cap: the customer leg is HUNG UP cleanly (bills talk time; no broken voicemail on the answered leg)", async () => {
    const actions = telnyxActions();
    const close = transferLegPatch([{ call_control_id: "transfer:x:1" }]);
    serve(close, liveCallStub(), actions);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "brt-leg-2",
        call_session_id: SESSION,
        direction: "outgoing",
        hangup_cause: "user_busy",
        client_state: buildTransferState({
          sessionId: SESSION,
          targetUserId: SENDER,
          senderUserId: SENDER,
          hops: 1,
          caller: CALLER,
        }),
      }),
    );

    const hangup = actions.calls.find(
      (c) => c.url.pathname === `/v2/calls/${CUSTOMER_CCID}/actions/hangup`,
    );
    expect(hangup).toBeDefined();
    // Never a broken answer/speak on the already-answered customer leg.
    expect(
      actions.calls.some((c) => c.url.pathname.endsWith("/speak")),
    ).toBe(false);
  });

  it("a normal end-of-call hangup of the transferee leg does nothing", async () => {
    const actions = telnyxActions();
    // The intent is already terminal ('answered') → close matches 0 rows.
    const close = transferLegPatch([]);
    serve(close, liveCallStub(), actions);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "brt-leg-1",
        call_session_id: SESSION,
        direction: "outgoing",
        hangup_cause: "normal_clearing",
        client_state: brtState(0),
      }),
    );
    expect(actions.calls).toHaveLength(0);
  });

  it("a missed transfer on an already-ended call recovers nothing", async () => {
    const actions = telnyxActions();
    const close = transferLegPatch([{ call_control_id: "transfer:x:0" }]);
    serve(close, liveCallStub({ outcome: "answered" }), actions);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "brt-leg-1",
        call_session_id: SESSION,
        direction: "outgoing",
        hangup_cause: "timeout",
        client_state: brtState(0),
      }),
    );
    expect(actions.calls).toHaveLength(0);
  });
});

describe("D43 phase 3 — consult legs (brc)", () => {
  it("bridges the two members when BOTH consult legs are answered", async () => {
    const actions = telnyxActions();
    // The guarded answer-claim now returns the matched row (a real consult leg).
    const legPatch = stubRoute(
      restMatch(env, "PATCH", "call_member_legs"),
      () => [{ call_control_id: "brc-t" }],
    );
    const legs = stubRoute(restMatch(env, "GET", "call_member_legs"), () => [
      { call_control_id: "brc-s", user_id: SENDER, state: "answered" },
      { call_control_id: "brc-t", user_id: TARGET, state: "answered" },
    ]);
    serve(legPatch, legs, actions);

    await handleCallEvent(
      env,
      event("call.answered", {
        call_control_id: "brc-t",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: buildConsultState({
          sessionId: SESSION,
          userId: TARGET,
          role: "t",
        }),
      }),
    );

    const bridge = actions.calls.find((c) =>
      c.url.pathname.endsWith("/bridge"),
    );
    expect(bridge).toBeDefined();
    expect(bridge!.url.pathname).toBe("/v2/calls/brc-t/actions/bridge");
    expect(bridge!.body).toMatchObject({ call_control_id: "brc-s" });
  });

  it("SECURITY: a FORGED brc answer (no ledgered consult leg) never bridges — the guard drops it", async () => {
    const actions = telnyxActions();
    // The claim update matches ZERO rows (no such consult leg for the session).
    const legPatch = stubRoute(
      restMatch(env, "PATCH", "call_member_legs"),
      () => [],
    );
    serve(legPatch, actions);

    await handleCallEvent(
      env,
      event("call.answered", {
        call_control_id: "brc-forged",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: buildConsultState({
          sessionId: SESSION,
          userId: TARGET,
          role: "t",
        }),
      }),
    );

    // No consultLegs read, no bridge — a forged brc can't steal a live leg.
    expect(actions.calls).toHaveLength(0);
  });

  it("one side up: no bridge yet", async () => {
    const actions = telnyxActions();
    const legPatch = stubRoute(
      restMatch(env, "PATCH", "call_member_legs"),
      () => [{ call_control_id: "brc-t" }],
    );
    const legs = stubRoute(restMatch(env, "GET", "call_member_legs"), () => [
      { call_control_id: "brc-s", user_id: SENDER, state: "ringing" },
      { call_control_id: "brc-t", user_id: TARGET, state: "answered" },
    ]);
    serve(legPatch, legs, actions);

    await handleCallEvent(
      env,
      event("call.answered", {
        call_control_id: "brc-t",
        call_session_id: SESSION,
        direction: "outgoing",
        client_state: buildConsultState({
          sessionId: SESSION,
          userId: TARGET,
          role: "t",
        }),
      }),
    );
    expect(actions.calls).toHaveLength(0);
  });

  it("a consult leg hanging up dismisses its sibling", async () => {
    const actions = telnyxActions();
    // The guarded close matches this live consult leg (returns it) → dismiss.
    const legPatch = stubRoute(
      restMatch(env, "PATCH", "call_member_legs"),
      () => [{ call_control_id: "brc-s" }],
    );
    const legs = stubRoute(restMatch(env, "GET", "call_member_legs"), () => [
      { call_control_id: "brc-s", user_id: SENDER, state: "answered" },
      { call_control_id: "brc-t", user_id: TARGET, state: "ringing" },
    ]);
    serve(legPatch, legs, actions);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "brc-s",
        call_session_id: SESSION,
        direction: "outgoing",
        hangup_cause: "normal_clearing",
        client_state: buildConsultState({
          sessionId: SESSION,
          userId: SENDER,
          role: "s",
        }),
      }),
    );

    const hangup = actions.calls.find((c) =>
      c.url.pathname.endsWith("/hangup"),
    );
    expect(hangup).toBeDefined();
    expect(hangup!.url.pathname).toBe("/v2/calls/brc-t/actions/hangup");
  });
});
