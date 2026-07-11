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
function numberStub(status = "active"): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "phone_numbers",
      (url) => url.searchParams.get("select")?.includes("company_id") ?? false,
    ),
    () => [{ id: NUMBER_ID, company_id: COMPANY_ID, status }],
  );
}

/**
 * The companies select shared by BOTH the call.initiated and the terminal
 * handlers: exactly id,forward_to_cell (no mctb_message — that is the
 * sendMissedCallText settings select).
 */
function companyStubs(
  forward: string | null,
  voice?: {
    plan: "starter" | "pro";
    currentPeriodStart: string;
    /** companies.overage_cap_multiplier as PostgREST serves it (numeric →
     *  string). Defaults to the DB default, "3.00". */
    capMultiplier?: string;
  },
  subscriptionStatus = "active",
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
          overage_cap_multiplier: voice?.capMultiplier ?? "3.00",
          subscription_status: subscriptionStatus,
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

/** api_period_forward_seconds RPC → forwarded (dialed-leg) seconds this period (D36). */
function voiceSecondsStub(seconds: number): Stub {
  return stubRoute(rpcMatch(env, "api_period_forward_seconds"), () => seconds);
}

/** company_modules voice row (D36 grandfathered gate). Default: paid module. */
function voiceModuleStub(grandfathered = false): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "company_modules",
      (url) => (url.searchParams.get("select") ?? "").includes("grandfathered"),
    ),
    () => [{ grandfathered }],
  );
}

/** call_records insert sink (#12 voice metering). Returns [] — the shape of
 *  an ignoreDuplicates conflict — so D36 meter reporting stays quiet unless a
 *  test opts in via {@link callRecordsInsertStub}. */
function callRecordsStub(): Stub {
  return stubRoute(restMatch(env, "POST", "call_records"), () =>
    Response.json([], { status: 201 }),
  );
}

/** call_records insert that LANDS (returns the new row id) — D36 reporting. */
function callRecordsInsertStub(rowId = "cr-1"): Stub {
  return stubRoute(restMatch(env, "POST", "call_records"), () =>
    Response.json([{ id: rowId }], { status: 201 }),
  );
}

/** companies → stripe_customer_id lookup (D36 meter reporting). */
function customerStub(): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => (url.searchParams.get("select") ?? "") === "stripe_customer_id",
    ),
    () => [{ stripe_customer_id: "cus_voice_1" }],
  );
}

/** Stripe meter_events endpoint (D36). */
function meterStub(
  respond: () => unknown = () => ({ object: "billing.meter_event" }),
): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.stripe.com/v1/billing/meter_events",
    respond,
  );
}

/** call_records stripe_reported_at stamp (D36). */
function stampStub(): Stub {
  return stubRoute(
    restMatch(env, "PATCH", "call_records"),
    () => new Response(null, { status: 204 }),
  );
}

/** #129: api_upsert_call RPC — echoes the merged session row. The default
 *  derives outcome/seconds from the request so threading sees what the SQL
 *  merge would return for a single-event call. */
function upsertCallStub(merged: Record<string, unknown> = {}): Stub {
  return stubRoute(rpcMatch(env, "api_upsert_call"), (call) => {
    const body = call.body as {
      p_call_session_id: string;
      p_caller_e164: string | null;
      p_outcome: string | null;
      p_forward_seconds: number;
    };
    return {
      id: "call-row-1",
      call_session_id: body.p_call_session_id,
      caller_e164: body.p_caller_e164,
      outcome: body.p_outcome,
      forward_seconds: body.p_forward_seconds,
      conversation_id: null,
      ...merged,
    };
  });
}

/** #129: api_thread_call RPC — default threads into a conversation. */
function threadCallStub(
  result: Record<string, unknown> = {
    contact_id: "ct-1",
    conversation_id: "bbbbbbbb-0000-4000-8000-00000000000b",
  },
): Stub {
  return stubRoute(rpcMatch(env, "api_thread_call"), () => result);
}

/** #129: the calls-row contact/conversation link PATCH. */
function callsLinkStub(): Stub {
  return stubRoute(
    restMatch(env, "PATCH", "calls"),
    () => new Response(null, { status: 204 }),
  );
}

/** Every #129 calls read-model stub a terminal-event test needs. */
function callsModelStubs(): Stub[] {
  return [upsertCallStub(), threadCallStub(), callsLinkStub()];
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

/**
 * Every terminal event now feeds the #129 calls read model, so its three
 * stubs are served by DEFAULT (appended last — a test's own upsert/thread/
 * link stub, passed explicitly, wins by order). Everything else still fails
 * loudly when unstubbed.
 */
function serve(...stubs: Stub[]) {
  stubFetch(
    ...([...stubs, ...callsModelStubs()].map((s) => s.route) as FetchRoute[]),
  );
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

  it("forwards normally when under the voice spending cap (#12/D36)", async () => {
    const action = telnyxCallAction();
    serve(
      numberStub(),
      ...companyStubs(CELL, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      // D36: PAST the 2,500-min allowance but under the 3× spending cap
      // (7,500 min) — the call still forwards; the extra minutes bill at
      // 1¢/min instead of being dropped.
      voiceSecondsStub(3000 * 60),
      voiceModuleStub(),
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

  it("rejects the call and never forwards at the voice spending cap (D36 pause boundary)", async () => {
    const action = telnyxCallAction();
    const reject = telnyxReject();
    serve(
      numberStub(),
      ...companyStubs(CELL, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      // Exactly at allowance × multiplier: 2,500 min × 3.00 = 7,500 min.
      voiceSecondsStub(7500 * 60),
      voiceModuleStub(),
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

  it("a GRANDFATHERED voice module pauses at the legacy 300 minutes (D36 review fix)", async () => {
    const action = telnyxCallAction();
    const reject = telnyxReject();
    serve(
      numberStub(),
      ...companyStubs(CELL, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      // Way under the paid 7,500-min cap, but at the grandfathered 300-min
      // boundary — nothing can bill a grandfathered module's overage, so it
      // keeps the pre-D36 deal exactly.
      voiceSecondsStub(300 * 60),
      voiceModuleStub(true),
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

    expect(reject.calls).toHaveLength(1);
    expect(action.calls).toHaveLength(0);
  });

  it("never forwards for a canceled (non-active subscription) company (#43)", async () => {
    const action = telnyxCallAction();
    serve(numberStub(), ...companyStubs(CELL, undefined, "canceled"), action);

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

    // A canceled company in its 30-day grace has forward_to_cell configured
    // but must NOT run two billable Telnyx legs on our dollar: no answer, no
    // transfer, no reject — the call rings out and the hangup is the missed
    // signal (where the text-back's own subscription gate applies).
    expect(action.calls).toHaveLength(0);
  });

  it("never forwards on a suspended number even when the company row reads active (#43)", async () => {
    const action = telnyxCallAction();
    serve(numberStub("suspended"), ...companyStubs(CELL), action);

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
      // D36: inbound legs never bill — stamped non-reportable at INSERT so
      // the hourly re-reporter's queue only ever holds forward legs.
      stripe_reported_at: expect.any(String),
    });
  });

  it("forward leg hangup reports its RAW SECONDS to the voice meter and stamps the row (D36)", async () => {
    const callRecords = callRecordsInsertStub("cr-fwd-1");
    const customer = customerStub();
    const meter = meterStub();
    const stamp = stampStub();
    serve(numberStub(), callRecords, customer, meter, stamp);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-1",
        from: OUR_NUMBER, // forward leg presents our number
        to: CELL,
        hangup_cause: "normal_clearing", // answered — seconds bill
        client_state: forwardState(CALLER),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:01:15.000Z", // 75 s, billed as 75 s
      }),
    );

    // The row enters the queue unstamped (reportable)…
    expect(callRecords.calls[0].body).toMatchObject({
      call_leg_id: "leg-fwd-1",
      leg: "forward",
      billable_seconds: 75,
      stripe_reported_at: null,
    });
    // …the meter event fires with the leg id as Stripe's dedupe identifier
    // and the SAME raw seconds the gate sums (1¢ per 60 s at rating time)…
    expect(meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("event_name")).toBe("voice_seconds");
    expect(form.get("identifier")).toBe("leg-fwd-1");
    expect(form.get("payload[stripe_customer_id]")).toBe("cus_voice_1");
    expect(form.get("payload[value]")).toBe("75");
    // …and the row is stamped (guarded, never overwriting a concurrent stamp).
    expect(stamp.calls).toHaveLength(1);
    expect(stamp.calls[0].url.searchParams.get("stripe_reported_at")).toBe(
      "is.null",
    );
  });

  it("a rang-out forward leg records ZERO billable seconds and never bills (D36 review fix)", async () => {
    const callRecords = callRecordsInsertStub("cr-fwd-ring");
    const meter = meterStub();
    const stamp = stampStub();
    serve(
      numberStub(),
      ...companyStubs(CELL),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claimStub(),
      telnyxSms(),
      persistStub(),
      ...alertStubs(),
      callRecords,
      meter,
      stamp,
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-ring",
        from: OUR_NUMBER,
        to: CELL,
        hangup_cause: "timeout", // rang out — a MISS, whatever window Telnyx stamps
        client_state: forwardState(CALLER),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:19.000Z", // 19 s of RING time
      }),
    );

    // Ring time is not a forwarded minute: zero seconds, stamped at insert,
    // no meter event — and the missed text-back still fires downstream.
    expect(callRecords.calls[0].body).toMatchObject({
      call_leg_id: "leg-fwd-ring",
      leg: "forward",
      billable_seconds: 0,
      stripe_reported_at: expect.any(String),
    });
    expect(meter.calls).toHaveLength(0);
  });

  it("#129: an answered forward-leg hangup merges the session, threads it (join-only), and links the row", async () => {
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    const link = callsLinkStub();
    serve(
      numberStub(),
      callRecordsInsertStub(),
      customerStub(),
      meterStub(),
      stampStub(),
      upsert,
      thread,
      link,
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-ans",
        from: OUR_NUMBER,
        to: CELL,
        hangup_cause: "normal_clearing",
        client_state: forwardState(CALLER),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:04:32.000Z", // 272 s of talk
      }),
    );

    expect(upsert.calls).toHaveLength(1);
    expect(upsert.calls[0].body).toMatchObject({
      p_call_session_id: SESSION,
      p_caller_e164: CALLER,
      p_outcome: "answered",
      p_forward_seconds: 272,
    });
    // Answered calls JOIN an open conversation, never create one.
    expect(thread.calls).toHaveLength(1);
    expect(thread.calls[0].body).toMatchObject({
      p_outcome: "answered",
      p_forward_seconds: 272,
      p_create_if_missing: false,
    });
    // The returned ids are linked onto the calls row (guarded on null).
    expect(link.calls).toHaveLength(1);
    expect(link.calls[0].url.searchParams.get("call_session_id")).toBe(
      `eq.${SESSION}`,
    );
    expect(link.calls[0].url.searchParams.get("conversation_id")).toBe(
      "is.null",
    );
  });

  it("#129: a no-forward miss threads with CREATE (a miss must reach the inbox even with text-back off)", async () => {
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    serve(
      numberStub(),
      callRecordsStub(),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claimStub(),
      telnyxSms(),
      persistStub(),
      ...alertStubs(),
      upsert,
      thread,
      callsLinkStub(),
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-inb-miss",
        direction: "incoming",
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:12.000Z",
      }),
    );

    expect(upsert.calls[0].body).toMatchObject({
      p_outcome: "missed",
      p_forward_seconds: 0,
    });
    expect(thread.calls).toHaveLength(1);
    expect(thread.calls[0].body).toMatchObject({
      p_outcome: "missed",
      p_create_if_missing: true,
    });
  });

  it("#129: an AMD machine verdict merges 'voicemail' but never threads (the hangup decides)", async () => {
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    // AMD machine also computes MISSED → the text-back chain fires (existing
    // behavior, unchanged) — stub it like the rings-out test.
    serve(
      numberStub(),
      ...companyStubs(CELL),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claimStub(),
      telnyxSms(),
      persistStub(),
      ...alertStubs(),
      upsert,
      thread,
      callsLinkStub(),
    );

    await handleCallEvent(
      env,
      event("call.machine.detection.ended", {
        call_session_id: SESSION,
        from: OUR_NUMBER,
        to: CELL,
        result: "machine",
        client_state: forwardState(CALLER),
      }),
    );

    expect(upsert.calls).toHaveLength(1);
    expect(upsert.calls[0].body).toMatchObject({ p_outcome: "voicemail" });
    expect(thread.calls).toHaveLength(0);
  });

  it("#129: an anonymous caller's call is recorded but never threaded", async () => {
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    serve(
      numberStub(),
      callRecordsInsertStub(),
      customerStub(),
      meterStub(),
      stampStub(),
      upsert,
      thread,
      callsLinkStub(),
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-anon",
        from: OUR_NUMBER,
        to: CELL,
        hangup_cause: "normal_clearing",
        // Caller-less forward tag: the inbound caller was anonymous/CLIR.
        client_state: btoa(FORWARD_LEG_STATE),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:01:00.000Z",
      }),
    );

    expect(upsert.calls).toHaveLength(1);
    expect(upsert.calls[0].body).toMatchObject({ p_caller_e164: null });
    expect(thread.calls).toHaveLength(0);
  });

  it("D38: agent-leg AMD 'human' bridges to the customer from the business number", async () => {
    const action = telnyxCallAction();
    const upsert = upsertCallStub();
    serve(numberStub(), action, upsert);

    await handleCallEvent(
      env,
      event("call.machine.detection.ended", {
        call_control_id: "cc-out-1",
        call_session_id: SESSION,
        from: OUR_NUMBER, // agent leg presents the business number
        to: "+16135557777", // the member's cell
        result: "human",
        client_state: btoa(`oc_agent|${CALLER}`),
      }),
    );

    const transfer = action.calls.find((c) =>
      c.url.pathname.endsWith("/transfer"),
    );
    expect(transfer).toBeDefined();
    expect(transfer!.body).toMatchObject({
      to: CALLER, // the customer
      from: OUR_NUMBER, // the customer sees the business number
      target_leg_client_state: btoa(`oc_customer|${CALLER}`),
    });
  });

  it("D38: agent-leg AMD 'machine' hangs up and marks the session missed — voicemail never bridges", async () => {
    const upsert = upsertCallStub();
    const hangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    serve(numberStub(), upsert, hangup);

    await handleCallEvent(
      env,
      event("call.machine.detection.ended", {
        call_control_id: "cc-out-2",
        call_session_id: SESSION,
        from: OUR_NUMBER,
        to: "+16135557777",
        result: "machine",
        client_state: btoa(`oc_agent|${CALLER}`),
      }),
    );

    expect(hangup.calls).toHaveLength(1);
    expect(upsert.calls).toHaveLength(1);
    expect(upsert.calls[0].body).toMatchObject({
      p_outcome: "missed",
      p_direction: "outbound",
    });
  });

  it("D38: a connected customer leg bills its seconds, threads join-only, and never texts back", async () => {
    const callRecords = callRecordsInsertStub("cr-out-1");
    const customerLookup = customerStub();
    const meter = meterStub();
    const stamp = stampStub();
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    const sms = telnyxSms();
    serve(
      numberStub(),
      callRecords,
      customerLookup,
      meter,
      stamp,
      upsert,
      thread,
      callsLinkStub(),
      sms,
    );

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-out-cust-1",
        from: OUR_NUMBER, // we present the business number
        to: CALLER, // the customer
        hangup_cause: "normal_clearing",
        client_state: btoa(`oc_customer|${CALLER}`),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:03:12.000Z", // 192 s of talk
      }),
    );

    expect(callRecords.calls[0].body).toMatchObject({
      leg: "out_customer",
      billable_seconds: 192,
      stripe_reported_at: null,
    });
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("payload[value]")).toBe("192");
    expect(upsert.calls[0].body).toMatchObject({
      p_outcome: "answered",
      p_direction: "outbound",
      p_caller_e164: CALLER,
    });
    expect(thread.calls[0].body).toMatchObject({
      p_create_if_missing: false,
      p_direction: "outbound",
    });
    // An outbound call must NEVER fire the missed-call text-back.
    expect(sms.calls).toHaveLength(0);
  });

  it("D38: a customer who doesn't pick up = missed, zero billed seconds, threaded, no text-back", async () => {
    const callRecords = callRecordsInsertStub("cr-out-2");
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    const sms = telnyxSms();
    serve(numberStub(), callRecords, upsert, thread, callsLinkStub(), sms);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-out-cust-2",
        from: OUR_NUMBER,
        to: CALLER,
        hangup_cause: "timeout",
        client_state: btoa(`oc_customer|${CALLER}`),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:25.000Z", // ring time only
      }),
    );

    expect(callRecords.calls[0].body).toMatchObject({
      leg: "out_customer",
      billable_seconds: 0,
      stripe_reported_at: expect.any(String),
    });
    expect(upsert.calls[0].body).toMatchObject({ p_outcome: "missed" });
    expect(thread.calls).toHaveLength(1); // "Called, no answer" is history
    expect(sms.calls).toHaveLength(0);
  });

  it("D38: an agent leg the member never answered stays list-only (no thread line)", async () => {
    const callRecords = callRecordsInsertStub("cr-out-3");
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    serve(numberStub(), callRecords, upsert, thread, callsLinkStub());

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-out-agent-1",
        from: OUR_NUMBER,
        to: "+16135557777",
        hangup_cause: "timeout",
        client_state: btoa(`oc_agent|${CALLER}`),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:25.000Z",
      }),
    );

    expect(callRecords.calls[0].body).toMatchObject({
      leg: "out_agent",
      stripe_reported_at: expect.any(String), // agent legs never bill
    });
    expect(upsert.calls[0].body).toMatchObject({
      p_outcome: "missed",
      p_direction: "outbound",
    });
    expect(thread.calls).toHaveLength(0); // the customer was never contacted
  });

  it("a replayed forward-leg hangup (insert conflict) never re-reports (D36)", async () => {
    const callRecords = callRecordsStub(); // [] = conflict, already recorded
    const meter = meterStub();
    const stamp = stampStub();
    serve(numberStub(), callRecords, meter, stamp);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-1",
        from: OUR_NUMBER,
        to: CELL,
        hangup_cause: "normal_clearing",
        client_state: forwardState(CALLER),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:01:15.000Z",
      }),
    );

    expect(meter.calls).toHaveLength(0);
    expect(stamp.calls).toHaveLength(0);
  });

  it("a failed meter report leaves the row unstamped for the hourly re-reporter (D36)", async () => {
    const callRecords = callRecordsInsertStub("cr-fwd-2");
    const customer = customerStub();
    const meter = meterStub(
      () => Response.json({ error: { message: "down" } }, { status: 500 }),
    );
    const stamp = stampStub();
    serve(numberStub(), callRecords, customer, meter, stamp);

    // Must not throw — the webhook still acks; the cron picks the row up.
    await handleCallEvent(
      env,
      event("call.hangup", {
        call_session_id: SESSION,
        call_leg_id: "leg-fwd-2",
        from: OUR_NUMBER,
        to: CELL,
        hangup_cause: "normal_clearing",
        client_state: forwardState(CALLER),
        start_time: "2026-07-04T10:00:00.000Z",
        end_time: "2026-07-04T10:00:30.000Z",
      }),
    );

    expect(stamp.calls).toHaveLength(0);
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

/**
 * #132: the crew alert is a missed-call behavior, decoupled from the
 * text-back. The webhook fires notifyMissedCall itself — gated on
 * api_thread_call's event_inserted claim — whenever the text-back path did
 * not (MCTB off, caller opted out). The claim path keeps its own alert, and
 * the two must never both fire for one call.
 */
describe("handleCallEvent — #132 crew alert without a text-back", () => {
  /** MCTB settings select with the feature DISABLED. */
  function mctbDisabledStub(): Stub {
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
          mctb_enabled: false,
          mctb_message: null,
          forward_to_cell: null,
          subscription_status: "active",
        },
      ],
    );
  }

  /** The notifyMissedCall conversation lookup, with a handle for counting. */
  function alertConversationStub(): Stub {
    return stubRoute(
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
    );
  }

  /** api_thread_call whose event INSERT landed this pass (a fresh miss). */
  function freshThreadStub(): Stub {
    return stubRoute(rpcMatch(env, "api_thread_call"), () => ({
      contact_id: "ct-1",
      conversation_id: "bbbbbbbb-0000-4000-8000-00000000000b",
      event_inserted: true,
    }));
  }

  function missedHangup(): TelnyxEvent {
    return event("call.hangup", {
      call_control_id: CC_ID,
      call_session_id: SESSION,
      direction: "incoming",
      from: CALLER,
      to: OUR_NUMBER,
      hangup_cause: "normal_clearing", // no-forward: the hangup IS the miss
    });
  }

  it("MCTB off: the crew alert still fires (no text, no claim)", async () => {
    const claim = claimStub();
    const sms = telnyxSms();
    const conv = alertConversationStub();
    serve(
      numberStub(),
      ...companyStubs(null),
      mctbDisabledStub(),
      claim,
      sms,
      conv,
      stubRoute(restMatch(env, "GET", "company_members"), () => []),
      stubRoute(restMatch(env, "GET", "notification_prefs"), () => []),
      freshThreadStub(),
    );

    await handleCallEvent(env, missedHangup());

    // No text-back machinery ran…
    expect(claim.calls).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
    // …but the crew alert did (its conversation lookup is the first step).
    expect(conv.calls).toHaveLength(1);
  });

  it("a webhook redelivery never re-alerts (event_inserted false)", async () => {
    const conv = alertConversationStub();
    serve(
      numberStub(),
      ...companyStubs(null),
      mctbDisabledStub(),
      conv,
      // default threadCallStub (via serve): no event_inserted → replay
    );

    await handleCallEvent(env, missedHangup());

    expect(conv.calls).toHaveLength(0);
  });

  it("text sent: exactly ONE alert (the claim path's), never a second from the webhook", async () => {
    const conv = alertConversationStub();
    serve(
      numberStub(),
      ...companyStubs(null),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claimStub(),
      telnyxSms(),
      persistStub(),
      conv,
      stubRoute(restMatch(env, "GET", "company_members"), () => []),
      stubRoute(restMatch(env, "GET", "notification_prefs"), () => []),
      freshThreadStub(), // fresh miss — the webhook WOULD alert if unguarded
    );

    await handleCallEvent(env, missedHangup());

    expect(conv.calls).toHaveLength(1);
  });

  it("caller opted out: no text, but the crew alert fires", async () => {
    const sms = telnyxSms();
    const conv = alertConversationStub();
    serve(
      numberStub(),
      ...companyStubs(null),
      mctbSettingsStub(),
      ...sendGateStubs(),
      stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
        skipped: "opted_out",
      })),
      sms,
      conv,
      stubRoute(restMatch(env, "GET", "company_members"), () => []),
      stubRoute(restMatch(env, "GET", "notification_prefs"), () => []),
      freshThreadStub(),
    );

    await handleCallEvent(env, missedHangup());

    expect(sms.calls).toHaveLength(0);
    expect(conv.calls).toHaveLength(1);
  });
});
