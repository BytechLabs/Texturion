/**
 * Inbound-call Call-Control handler (FEATURE-GAPS voice wave, Step 1c). Drives
 * handleCallEvent with MOCKED Telnyx Call-Control webhook events:
 *   - call.initiated (incoming) with forward_to_cell set → answers the inbound
 *     leg and dials the forward cell with a ring timeout + AMD;
 *   - call.initiated with NO forward → never answered (no dead air, no billed
 *     leg) — the call rings out and the hangup is the missed signal;
 *   - the forward leg's terminal signal (hangup timeout / AMD machine) → the
 *     text-back fires; AMD 'human' → no text;
 *   - no-forward: the inbound-leg hangup fires the text-back immediately.
 * Only the network edge (global fetch) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import {
  messageRow,
  restMatch,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  handleCallEvent,
  FORWARD_LEG_STATE,
  INBOUND_FORWARDED_STATE,
} from "./voice-webhook";
import type { TelnyxEvent } from "./types";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const OUR_NUMBER = "+16135550100";
const CALLER = "+16135551000";
const CELL = "+16135559999";
const CC_ID = "cc-id-1";
const SESSION = "sess-1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function forwardState(caller: string): string {
  return btoa(`${FORWARD_LEG_STATE}|${caller}`);
}

/** phone_numbers resolution by dialed number. */
function numberStub(): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "phone_numbers",
      (url) => url.searchParams.get("select")?.includes("company_id") ?? false,
    ),
    () => [{ id: NUMBER_ID, company_id: COMPANY_ID }],
  );
}

/**
 * The companies select shared by BOTH the call.initiated and the terminal
 * handlers: exactly id,forward_to_cell (no mctb_message — that is the
 * sendMissedCallText settings select).
 */
function companyStubs(
  forward: string | null,
  voice?: { plan: "starter" | "pro"; currentPeriodStart: string },
): Stub[] {
  return [
    stubRoute(
      restMatch(
        env,
        "GET",
        "companies",
        (url) => {
          const sel = url.searchParams.get("select") ?? "";
          return sel.includes("forward_to_cell") && !sel.includes("mctb_message");
        },
      ),
      () => [
        {
          id: COMPANY_ID,
          forward_to_cell: forward,
          plan: voice?.plan ?? null,
          current_period_start: voice?.currentPeriodStart ?? null,
        },
      ],
    ),
  ];
}

/** MCTB settings select used by sendMissedCallText. */
function mctbSettingsStub(): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => url.searchParams.get("select")?.includes("mctb_message") ?? false,
    ),
    () => [
      {
        name: "Ace Plumbing",
        mctb_enabled: true,
        mctb_message: "Sorry we missed you — reply to book.",
        forward_to_cell: null,
        subscription_status: "active",
      },
    ],
  );
}

function sendGateStubs(): Stub[] {
  return [
    stubRoute(
      restMatch(
        env,
        "GET",
        "companies",
        (url) =>
          url.searchParams.get("select")?.includes("subscription_status") ??
          false,
      ),
      () => [
        {
          id: COMPANY_ID,
          name: "Ace Plumbing",
          country: "CA",
          us_texting_enabled: true,
          subscription_status: "active",
        },
      ],
    ),
    stubRoute(restMatch(env, "GET", "messaging_registrations"), () => []),
  ];
}

function telnyxCallAction(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/calls\/[^/]+\/actions\/(answer|transfer)$/.test(url.pathname),
    () => ({ data: { result: "ok" } }),
  );
}

function telnyxReject(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/calls\/[^/]+\/actions\/reject$/.test(url.pathname),
    () => ({ data: { result: "ok" } }),
  );
}

/** api_period_voice_seconds RPC → the company's used voice seconds this period. */
function voiceSecondsStub(seconds: number): Stub {
  return stubRoute(rpcMatch(env, "api_period_voice_seconds"), () => seconds);
}

/** call_records insert sink (#12 voice metering). */
function callRecordsStub(): Stub {
  return stubRoute(restMatch(env, "POST", "call_records"), () =>
    Response.json([], { status: 201 }),
  );
}

function telnyxSms(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: "telnyx-mctb-1" } }),
  );
}

function alertStubs(): Stub[] {
  return [
    stubRoute(
      restMatch(
        env,
        "GET",
        "conversations",
        (url) =>
          url.searchParams.get("select")?.includes("assigned_user_id") ?? false,
      ),
      () => [
        {
          id: "bbbbbbbb-0000-4000-8000-00000000000b",
          assigned_user_id: null,
          contacts: { name: null, phone_e164: CALLER },
        },
      ],
    ),
    stubRoute(restMatch(env, "GET", "company_members"), () => []),
    stubRoute(restMatch(env, "GET", "notification_prefs"), () => []),
  ];
}

function claimStub(): Stub {
  return stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
    message: messageRow({ status: "queued" }),
    conversation_id: "bbbbbbbb-0000-4000-8000-00000000000b",
    created_conversation: true,
  }));
}

function persistStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "PATCH" && url.pathname === "/rest/v1/messages",
    () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
  );
}

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function event(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  return { data: { id: "evt-1", event_type: eventType, payload } };
}

describe("handleCallEvent — inbound call.initiated", () => {
  it("answers the inbound leg and dials the forward cell with timeout + AMD", async () => {
    const action = telnyxCallAction();
    serve(numberStub(), ...companyStubs(CELL), action);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
      }),
    );

    const answer = action.calls.find((c) => c.url.pathname.endsWith("/answer"));
    const transfer = action.calls.find((c) =>
      c.url.pathname.endsWith("/transfer"),
    );
    expect(answer).toBeDefined();
    expect(transfer).toBeDefined();
    expect(transfer!.body).toMatchObject({
      to: CELL,
      answering_machine_detection: "detect_beep",
      // Telnyx transfer contract: client_state tags the leg the command runs
      // ON (the inbound leg); target_leg_client_state tags the NEW dialed
      // leg. The forward tag (with the caller) MUST ride the target param —
      // putting it on client_state would tag the wrong leg and the text-back
      // would never fire in production.
      client_state: btoa(INBOUND_FORWARDED_STATE),
      target_leg_client_state: forwardState(CALLER),
    });
    // Ring timeout is set so a rang-out forward computes MISSED.
    expect((transfer!.body as { timeout_secs?: number }).timeout_secs).toBeGreaterThan(0);
    // #12: a per-call duration ceiling bounds one call's cost (1h).
    expect(
      (transfer!.body as { time_limit_secs?: number }).time_limit_secs,
    ).toBe(60 * 60);
  });

  it("never answers when no forward is configured (rings out; hangup is the signal)", async () => {
    const action = telnyxCallAction();
    serve(numberStub(), ...companyStubs(null), action);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
      }),
    );

    // Answering with no one to connect would be dead air + a billed leg — the
    // call must be left ringing so the caller hears a natural "no answer".
    expect(action.calls).toHaveLength(0);
  });

  it("ignores the outgoing forward leg's own call.initiated", async () => {
    const action = telnyxCallAction();
    serve(numberStub(), ...companyStubs(CELL), action);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: "forward-cc",
        call_session_id: SESSION,
        direction: "outgoing",
        from: OUR_NUMBER,
        to: CELL,
        client_state: forwardState(CALLER),
      }),
    );
    expect(action.calls).toHaveLength(0);
  });

  it("forwards normally when under the voice-minute cap (#12)", async () => {
    const action = telnyxCallAction();
    serve(
      numberStub(),
      ...companyStubs(CELL, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      voiceSecondsStub(100 * 60), // 100 of the 300 included minutes
      action,
    );

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
      }),
    );

    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/answer")),
    ).toBe(true);
    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/transfer")),
    ).toBe(true);
  });

  it("rejects the call and never forwards when over the voice-minute cap (#12 cap-and-drop)", async () => {
    const action = telnyxCallAction();
    const reject = telnyxReject();
    serve(
      numberStub(),
      ...companyStubs(CELL, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      voiceSecondsStub(300 * 60), // exactly at the 300-minute allowance
      action,
      reject,
    );

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
      }),
    );

    // The expensive two-leg forward is avoided — the call is rejected instead.
    // Its untagged hangup will flow through the normal missed path (text-back).
    expect(reject.calls).toHaveLength(1);
    expect(reject.calls[0].body).toMatchObject({ cause: "USER_BUSY" });
    expect(action.calls).toHaveLength(0);
  });
});

describe("handleCallEvent — terminal → text-back", () => {
  it("no-forward: inbound-leg hangup fires the text-back", async () => {
    const claim = claimStub();
    const sms = telnyxSms();
    serve(
      numberStub(),
      ...companyStubs(null),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claim,
      sms,
      persistStub(),
      ...alertStubs(),
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
      }),
    );

    expect(claim.calls).toHaveLength(1);
    expect(sms.calls).toHaveLength(1);
  });

  it("forward leg AMD 'human' does NOT text back", async () => {
    const claim = claimStub();
    const sms = telnyxSms();
    serve(numberStub(), ...companyStubs(CELL), claim, sms);

    await handleCallEvent(
      env,
      event("call.machine.detection.ended", {
        call_session_id: SESSION,
        from: OUR_NUMBER,
        to: CELL,
        result: "human",
        client_state: forwardState(CALLER),
      }),
    );

    expect(claim.calls).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
  });

  it("forward leg rings out (hangup timeout) fires the text-back to the original caller", async () => {
    const claim = claimStub();
    const sms = telnyxSms();
    serve(
      numberStub(),
      ...companyStubs(CELL),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claim,
      sms,
      persistStub(),
      ...alertStubs(),
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        from: OUR_NUMBER, // forward leg presents our number
        to: CELL,
        hangup_cause: "timeout",
        client_state: forwardState(CALLER),
      }),
    );

    expect(claim.calls).toHaveLength(1);
    // The original caller (recovered from client_state) is the SMS destination.
    expect(sms.calls).toHaveLength(1);
    expect(sms.calls[0].body).toMatchObject({ to: CALLER, from: OUR_NUMBER });
  });

  it("records a leg's billable duration on hangup (#12 voice metering)", async () => {
    const callRecords = callRecordsStub();
    // An inbound_forwarded leg hangup is NOT missed (only the forward leg
    // decides), so no text-back fires — but the duration is still metered,
    // proving recording happens before the missed-vs-answered branch.
    serve(numberStub(), callRecords);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-inb-1",
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
        client_state: btoa(INBOUND_FORWARDED_STATE),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:45.000Z", // 45 seconds
      }),
    );

    expect(callRecords.calls).toHaveLength(1);
    expect(callRecords.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      call_leg_id: "leg-inb-1",
      leg: "inbound",
      billable_seconds: 45,
    });
  });

  it("does not meter a hangup with no duration window", async () => {
    const callRecords = callRecordsStub();
    serve(numberStub(), ...companyStubs(CELL), callRecords);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-inb-2",
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
        client_state: btoa(INBOUND_FORWARDED_STATE),
        // no start_time / end_time
      }),
    );

    expect(callRecords.calls).toHaveLength(0);
  });

  it("forward configured: the inbound leg's own hangup does NOT fire (only the forward leg decides)", async () => {
    const claim = claimStub();
    const sms = telnyxSms();
    serve(numberStub(), ...companyStubs(CELL), claim, sms);

    // The inbound leg of a FORWARDED call carries the tag we stamped on the
    // transfer command's client_state — that tag (not a company re-read) is
    // what stops its hangup from being misread as a no-forward miss.
    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
        client_state: btoa(INBOUND_FORWARDED_STATE),
      }),
    );

    expect(claim.calls).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
  });
});
