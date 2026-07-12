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
 * The call.initiated companies select (D43 v2): id, name, the voice-cap
 * fields, and the Calls settings (call_screening / voicemail_greeting). The
 * legacy first parameter is retained (ignored) so pre-v2 call sites stay
 * unchanged — the terminal handlers never read companies at all.
 */
function companyStubs(
  _forward: string | null,
  voice?: {
    plan: "starter" | "pro";
    currentPeriodStart: string;
    /** companies.overage_cap_multiplier as PostgREST serves it (numeric →
     *  string). Defaults to the DB default, "3.00". */
    capMultiplier?: string;
  },
  subscriptionStatus = "active",
  calls?: { screening?: "off" | "flag" | "divert"; greeting?: string | null },
): Stub[] {
  return [
    stubRoute(
      restMatch(
        env,
        "GET",
        "companies",
        (url) => {
          const sel = url.searchParams.get("select") ?? "";
          return sel.includes("call_screening") && !sel.includes("mctb_message");
        },
      ),
      () => [
        {
          id: COMPANY_ID,
          name: "Ace Plumbing",
          plan: voice?.plan ?? null,
          current_period_start: voice?.currentPeriodStart ?? null,
          overage_cap_multiplier: voice?.capMultiplier ?? "3.00",
          subscription_status: subscriptionStatus,
          call_screening: calls?.screening ?? "flag",
          voicemail_greeting: calls?.greeting ?? null,
        },
      ],
    ),
  ];
}

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";

/**
 * D43 ring-world defaults: line not busy, no prior ring ledger, one
 * credentialed owner (USER_A). Override via options for busy/no-member/
 * restricted worlds.
 */
function ringWorldStubs(opts?: {
  /** api_claim_inbound_line's busy verdict (D43 atomic line claim). */
  busy?: boolean;
  credentials?: { user_id: string; sip_username: string }[];
  members?: { user_id: string; role: string }[];
  accessRules?: Record<string, unknown>[];
}): Stub[] {
  return [
    // Replay guard: no prior calls row for this session.
    stubRoute(restMatch(env, "GET", "calls"), () => []),
    // Atomic line claim (inserts the row + returns busy).
    stubRoute(
      rpcMatch(env, "api_claim_inbound_line"),
      () => opts?.busy ?? false,
    ),
    // v2 metadata stamp.
    stubRoute(
      restMatch(env, "PATCH", "calls"),
      () => new Response(null, { status: 204 }),
    ),
    stubRoute(restMatch(env, "GET", "call_member_legs"), () => []),
    stubRoute(restMatch(env, "POST", "call_member_legs"), () =>
      Response.json([], { status: 201 }),
    ),
    stubRoute(restMatch(env, "GET", "member_telephony_credentials"), () =>
      opts?.credentials ?? [{ user_id: USER_A, sip_username: "gencred_a" }],
    ),
    stubRoute(restMatch(env, "GET", "company_members"), () =>
      opts?.members ?? [{ user_id: USER_A, role: "owner" }],
    ),
    stubRoute(restMatch(env, "GET", "number_access"), () =>
      opts?.accessRules ?? [],
    ),
  ];
}

/** Telnyx Dial (POST /v2/calls) — the member browser ring legs. */
function telnyxDial(ccid = "member-leg-1"): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" && url.pathname === "/v2/calls",
    () => ({ data: { call_control_id: ccid, call_session_id: SESSION } }),
  );
}

/** Telnyx call actions the v2 flows use (answer/speak/record/bridge/hangup). */
function telnyxV2Actions(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/calls\/[^/]+\/actions\/(answer|speak|record_start|bridge|hangup)$/.test(
        url.pathname,
      ),
    () => ({ data: { result: "ok" } }),
  );
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
 * link stub, passed explicitly, wins by order). D43 adds two more defaults:
 * the untagged-hangup ring-cancel read (GET call_member_legs → none ringing)
 * and its hangup action. Everything else still fails loudly when unstubbed.
 */
function serve(...stubs: Stub[]) {
  const d43Defaults: Stub[] = [
    stubRoute(restMatch(env, "GET", "call_member_legs"), () => []),
    // Default GET calls: a bare {id} row. Enough for the terminal handler's
    // "does a genuine server-created row exist?" security check on
    // forward/out_agent/out_customer legs to pass (a real call has one), but
    // WITHOUT phone_number_id/answered_at so the answer-time threading + the
    // out_customer billing anchor stay graceful no-ops unless a test opts in
    // with its own richer stub. A test proving a FORGED leg is dropped
    // overrides this with an empty read.
    stubRoute(restMatch(env, "GET", "calls"), () => [{ id: "existing-row" }]),
  ];
  stubFetch(
    ...([...stubs, ...callsModelStubs(), ...d43Defaults].map(
      (s) => s.route,
    ) as FetchRoute[]),
  );
}

function event(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  return { data: { id: "evt-1", event_type: eventType, payload } };
}

describe("handleCallEvent — inbound call.initiated (D43 v2 ring)", () => {
  const initiated = () =>
    event("call.initiated", {
      call_control_id: CC_ID,
      call_session_id: SESSION,
      direction: "incoming",
      from: CALLER,
      to: OUR_NUMBER,
    });

  it("rings the member's browser (sip dial, brm tag) and does NOT answer the inbound leg", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    const ledger = stubRoute(restMatch(env, "POST", "call_member_legs"), () =>
      Response.json([], { status: 201 }),
    );
    serve(
      numberStub(),
      ...companyStubs(null),
      // The observed ledger stub must precede ringWorldStubs' own POST sink
      // (first-registered wins in the fetch stub).
      ledger,
      ...ringWorldStubs(),
      dial,
      action,
    );

    await handleCallEvent(env, initiated());

    expect(dial.calls).toHaveLength(1);
    expect(dial.calls[0].body).toMatchObject({
      to: "sip:gencred_a@sip.telnyx.com",
      from: CALLER, // the member sees who is really calling
      connection_id: env.TELNYX_VOICE_CONNECTION_ID,
    });
    const state = atob(
      (dial.calls[0].body as { client_state: string }).client_state,
    );
    // brm|<session>|<user>|<caller>|<inbound ccid> — the answer/failure
    // races and the bridge recover everything from the tag alone.
    expect(state).toBe(`brm|${SESSION}|${USER_A}|${CALLER}|${CC_ID}`);
    // The caller keeps hearing real carrier ringback: no answer while ringing.
    expect(
      action.calls.filter((c) => c.url.pathname.endsWith("/answer")),
    ).toHaveLength(0);
    // The ring ledger rows landed (the races are decided on them).
    expect(ledger.calls).toHaveLength(1);
  });

  it("a notes-only member's browser never rings (#106 — customer calls need 'text')", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null),
      ...ringWorldStubs({
        members: [{ user_id: USER_A, role: "member" }],
        accessRules: [
          {
            phone_number_id: NUMBER_ID,
            principal_kind: "user",
            principal: USER_A,
            level: "note",
          },
        ],
      }),
      dial,
      action,
    );

    await handleCallEvent(env, initiated());

    // Nobody eligible → straight to voicemail (answer + greeting).
    expect(dial.calls).toHaveLength(0);
    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/answer")),
    ).toBe(true);
    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/speak")),
    ).toBe(true);
  });

  it("goes to voicemail (answer + default greeting with the company name) when nobody holds a credential", async () => {
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null),
      ...ringWorldStubs({ credentials: [] }),
      action,
    );

    await handleCallEvent(env, initiated());

    const answer = action.calls.find((c) => c.url.pathname.endsWith("/answer"));
    const speak = action.calls.find((c) => c.url.pathname.endsWith("/speak"));
    expect(answer).toBeDefined();
    expect(speak).toBeDefined();
    // Both carry the vmi tag so speak.ended → record_start routes.
    expect(atob((answer!.body as { client_state: string }).client_state)).toBe(
      `vmi|${CALLER}`,
    );
    expect((speak!.body as { payload: string }).payload).toContain(
      "Ace Plumbing",
    );
  });

  it("speaks the owner-authored greeting when one exists", async () => {
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null, undefined, "active", {
        greeting: "Leave it after the beep, eh.",
      }),
      ...ringWorldStubs({ credentials: [] }),
      action,
    );

    await handleCallEvent(env, initiated());

    const speak = action.calls.find((c) => c.url.pathname.endsWith("/speak"));
    expect((speak!.body as { payload: string }).payload).toBe(
      "Leave it after the beep, eh.",
    );
  });

  it("line busy (another live call on this number) → voicemail, no ring", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null),
      ...ringWorldStubs({ busy: true }),
      dial,
      action,
    );

    await handleCallEvent(env, initiated());

    expect(dial.calls).toHaveLength(0);
    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/speak")),
    ).toBe(true);
  });

  it("screening 'divert' + a flagged caller → voicemail, the team is never interrupted", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null, undefined, "active", { screening: "divert" }),
      ...ringWorldStubs(),
      dial,
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
        call_screening_result: "flagged_as_spam",
      }),
    );

    expect(dial.calls).toHaveLength(0);
    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/speak")),
    ).toBe(true);
  });

  it("screening 'flag' only labels — a flagged caller still rings the team", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    const meta = callsLinkStub();
    serve(
      numberStub(),
      ...companyStubs(null, undefined, "active", { screening: "flag" }),
      // The observed metadata PATCH must precede ringWorldStubs' own PATCH
      // sink (first-registered wins in the fetch stub).
      meta,
      ...ringWorldStubs(),
      dial,
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
        call_screening_result: "flagged_as_spam",
        shaken_stir_attestation: "C",
      }),
    );

    expect(dial.calls).toHaveLength(1);
    // The verdict is persisted for honest UI labels either way.
    const stamp = meta.calls.find(
      (c) =>
        (c.body as Record<string, unknown> | null)?.screening_result ===
        "flagged_as_spam",
    );
    expect(stamp).toBeDefined();
    expect((stamp!.body as Record<string, unknown>).stir_attestation).toBe("C");
    expect(
      (stamp!.body as Record<string, unknown>).customer_call_control_id,
    ).toBe(CC_ID);
  });

  it("ignores our OWN server-issued outgoing legs — those dial a SIP credential URI (never gated)", async () => {
    const action = telnyxV2Actions();
    serve(numberStub(), ...companyStubs(null), action);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: "member-ring-cc",
        call_session_id: SESSION,
        direction: "outgoing",
        from: CALLER,
        // A member ring / consult / transfer leg dials a SIP URI — the
        // server-controlled discriminator that a browser can't fake for PSTN.
        to: "sip:gencred_a@sip.telnyx.com",
        client_state: btoa(`brm|${SESSION}|${USER_A}|${CALLER}|cc-inbound`),
      }),
    );
    expect(action.calls).toHaveLength(0);
  });

  it("an ANONYMOUS/CLIR caller ('anonymous') rings the team with the business number as the SIP from", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(numberStub(), ...companyStubs(null), ...ringWorldStubs(), dial, action);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        direction: "incoming",
        from: "anonymous", // Telnyx CLIR marker — NOT a valid E.164
        to: OUR_NUMBER,
      }),
    );

    expect(dial.calls).toHaveLength(1);
    // The invalid 'anonymous' marker never reaches the SIP `from` (would 422
    // the dial and silence the team) — the business number is presented, and
    // the brm tag carries an EMPTY caller.
    expect((dial.calls[0].body as { from: string }).from).toBe(OUR_NUMBER);
    const state = atob(
      (dial.calls[0].body as { client_state: string }).client_state,
    );
    expect(state).toBe(`brm|${SESSION}|${USER_A}||${CC_ID}`);
  });

  it("skips a replayed initiated for a call that already ENDED (no re-ring)", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    // The replay-guard read finds a prior row with a terminal outcome.
    const priorRow = stubRoute(restMatch(env, "GET", "calls"), () => [
      { outcome: "missed" },
    ]);
    serve(numberStub(), priorRow, dial, action);

    await handleCallEvent(env, initiated());

    expect(dial.calls).toHaveLength(0);
    expect(action.calls).toHaveLength(0);
  });

  it("rings normally when under the voice spending cap (#12/D36)", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      // D36: PAST the 2,500-min allowance but under the 3× spending cap
      // (7,500 min) — the call still rings; the extra minutes bill at 1¢/min.
      voiceSecondsStub(3000 * 60),
      ...ringWorldStubs(),
      dial,
      action,
    );

    await handleCallEvent(env, initiated());

    expect(dial.calls).toHaveLength(1);
  });

  it("rejects the call at the voice spending cap (D36 pause boundary)", async () => {
    const dial = telnyxDial();
    const reject = telnyxReject();
    serve(
      numberStub(),
      ...companyStubs(null, {
        plan: "starter",
        currentPeriodStart: "2026-07-01T00:00:00Z",
      }),
      // Exactly at allowance × multiplier: 2,500 min × 3.00 = 7,500 min.
      voiceSecondsStub(7500 * 60),
      dial,
      reject,
    );

    await handleCallEvent(env, initiated());

    // No ring, no voicemail — the call is rejected; its untagged hangup
    // flows through the normal missed path (text-back).
    expect(reject.calls).toHaveLength(1);
    expect(reject.calls[0].body).toMatchObject({ cause: "USER_BUSY" });
    expect(dial.calls).toHaveLength(0);
  });

  it("never rings for a canceled (non-active subscription) company (#43)", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(
      numberStub(),
      ...companyStubs(null, undefined, "canceled"),
      dial,
      action,
    );

    await handleCallEvent(env, initiated());

    // A canceled company in its 30-day grace must not run billable legs on
    // our dollar: no ring, no voicemail — the call rings out and the hangup
    // is the missed signal (where the text-back's subscription gate applies).
    expect(dial.calls).toHaveLength(0);
    expect(action.calls).toHaveLength(0);
  });

  it("never rings on a suspended number even when the company row reads active (#43)", async () => {
    const dial = telnyxDial();
    const action = telnyxV2Actions();
    serve(numberStub("suspended"), ...companyStubs(null), dial, action);

    await handleCallEvent(env, initiated());

    expect(dial.calls).toHaveLength(0);
    expect(action.calls).toHaveLength(0);
  });
});

describe("handleCallEvent — D43 member ring races", () => {
  const MEMBER_LEG = "member-leg-1";
  const brmState = btoa(`brm|${SESSION}|${USER_A}|${CALLER}|${CC_ID}`);

  function memberEvent(eventType: string): TelnyxEvent {
    return event(eventType, {
      call_control_id: MEMBER_LEG,
      call_session_id: SESSION,
      direction: "outgoing",
      from: CALLER,
      to: "sip:gencred_a@sip.telnyx.com",
      client_state: brmState,
    });
  }

  it("first answer wins: answers the inbound leg (bri tag), bridges, stamps, dismisses siblings", async () => {
    const action = telnyxV2Actions();
    const claim = stubRoute(rpcMatch(env, "api_claim_ring_answer"), () => "won");
    const stamp = callsLinkStub();
    const siblings = stubRoute(
      restMatch(env, "GET", "call_member_legs"),
      () => [{ call_control_id: "member-leg-2" }],
    );
    serve(claim, stamp, siblings, action);

    await handleCallEvent(env, memberEvent("call.answered"));

    const answer = action.calls.find(
      (c) =>
        c.url.pathname === `/v2/calls/${CC_ID}/actions/answer`,
    );
    expect(answer).toBeDefined();
    const briState = atob(
      (answer!.body as { client_state: string }).client_state,
    );
    expect(briState.startsWith(`bri|${CALLER}|`)).toBe(true);
    // The bridge runs ON the member leg, targeting the inbound leg.
    const bridge = action.calls.find(
      (c) => c.url.pathname === `/v2/calls/${MEMBER_LEG}/actions/bridge`,
    );
    expect(bridge).toBeDefined();
    expect(bridge!.body).toMatchObject({ call_control_id: CC_ID });
    // Who-answered stamp (guarded on answered_at null).
    const answeredStamp = stamp.calls.find(
      (c) =>
        (c.body as Record<string, unknown> | null)?.answered_by_user_id ===
        USER_A,
    );
    expect(answeredStamp).toBeDefined();
    // The losing sibling is dismissed.
    const hangup = action.calls.find(
      (c) => c.url.pathname === "/v2/calls/member-leg-2/actions/hangup",
    );
    expect(hangup).toBeDefined();
  });

  it("a late answer loses the claim and is hung up (never double-bridged)", async () => {
    const action = telnyxV2Actions();
    const claim = stubRoute(
      rpcMatch(env, "api_claim_ring_answer"),
      () => "lost",
    );
    serve(claim, action);

    await handleCallEvent(env, memberEvent("call.answered"));

    expect(action.calls).toHaveLength(1);
    expect(action.calls[0].url.pathname).toBe(
      `/v2/calls/${MEMBER_LEG}/actions/hangup`,
    );
  });

  it("the LAST failed leg starts voicemail on the inbound leg", async () => {
    const action = telnyxV2Actions();
    const failed = stubRoute(rpcMatch(env, "api_ring_leg_failed"), () => true);
    const sessionRead = stubRoute(
      restMatch(env, "GET", "calls"),
      () => [{ company_id: COMPANY_ID }],
    );
    const companyRead = stubRoute(
      restMatch(
        env,
        "GET",
        "companies",
        (url) =>
          (url.searchParams.get("select") ?? "").includes(
            "voicemail_greeting",
          ),
      ),
      () => [{ name: "Ace Plumbing", voicemail_greeting: null }],
    );
    serve(failed, sessionRead, companyRead, action);

    await handleCallEvent(env, memberEvent("call.hangup"));

    const answer = action.calls.find(
      (c) => c.url.pathname === `/v2/calls/${CC_ID}/actions/answer`,
    );
    const speak = action.calls.find(
      (c) => c.url.pathname === `/v2/calls/${CC_ID}/actions/speak`,
    );
    expect(answer).toBeDefined();
    expect(speak).toBeDefined();
  });

  it("a NON-last failed leg does nothing further", async () => {
    const action = telnyxV2Actions();
    const failed = stubRoute(rpcMatch(env, "api_ring_leg_failed"), () => false);
    serve(failed, action);

    await handleCallEvent(env, memberEvent("call.hangup"));

    expect(action.calls).toHaveLength(0);
  });

  it("REPLAY of the winner's answer ('already') re-runs idempotently and NEVER hangs the winner up", async () => {
    const action = telnyxV2Actions();
    const claim = stubRoute(
      rpcMatch(env, "api_claim_ring_answer"),
      () => "already",
    );
    const stamp = callsLinkStub(); // guarded answered stamp (matches 0 on replay)
    serve(claim, stamp, action);

    await handleCallEvent(env, memberEvent("call.answered"));

    // The critical invariant: the WINNER's member leg is never hung up.
    expect(
      action.calls.find(
        (c) => c.url.pathname === `/v2/calls/${MEMBER_LEG}/actions/hangup`,
      ),
    ).toBeUndefined();
    // The connect is re-driven idempotently (both 4xx-tolerated in prod), so
    // a first pass that threw mid-sequence still completes.
    expect(
      action.calls.some(
        (c) => c.url.pathname === `/v2/calls/${CC_ID}/actions/answer`,
      ),
    ).toBe(true);
    expect(
      action.calls.some(
        (c) => c.url.pathname === `/v2/calls/${MEMBER_LEG}/actions/bridge`,
      ),
    ).toBe(true);
  });

  it("caller hangs up mid-ring: every ringing browser is dismissed", async () => {
    const action = telnyxV2Actions();
    const ringing = stubRoute(
      restMatch(env, "GET", "call_member_legs"),
      () => [
        { call_control_id: "member-leg-1" },
        { call_control_id: "member-leg-2" },
      ],
    );
    serve(
      numberStub(),
      ringing,
      action,
      // The untagged hangup then runs the normal missed path.
      callRecordsStub(),
      mctbSettingsStub(),
      ...sendGateStubs(),
      claimStub(),
      telnyxSms(),
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
        hangup_cause: "originator_cancel",
        start_time: "2026-07-12T00:00:00Z",
        end_time: "2026-07-12T00:00:10Z",
      }),
    );

    expect(
      action.calls.filter((c) => c.url.pathname.endsWith("/hangup")),
    ).toHaveLength(2);
  });
});

describe("handleCallEvent — D43 voicemail pipeline", () => {
  const vmiState = btoa(`vmi|${CALLER}`);

  it("greeting finished (speak.ended, vmi tag) → record_start with beep + cap", async () => {
    const action = telnyxV2Actions();
    serve(action);

    await handleCallEvent(
      env,
      event("call.speak.ended", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        client_state: vmiState,
      }),
    );

    const record = action.calls.find((c) =>
      c.url.pathname.endsWith("/record_start"),
    );
    expect(record).toBeDefined();
    expect(record!.body).toMatchObject({
      format: "mp3",
      play_beep: true,
      max_length: 120,
    });
  });

  it("recording.saved: fetches within the presigned window, stores, stamps, threads, deletes the Telnyx copy", async () => {
    const audio = new Uint8Array([73, 68, 51, 4]); // "ID3…"
    const mp3Fetch = stubRoute(
      (url) => url.hostname === "recordings.telnyx.example",
      () => new Response(audio, { status: 200 }),
    );
    const storagePut = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.pathname.startsWith("/storage/v1/object/voicemails/"),
      () => Response.json({ Key: "ok" }),
    );
    const stamp = callsLinkStub();
    const upsert = upsertCallStub({ conversation_id: null });
    const thread = threadCallStub();
    const eventScan = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    const eventInsert = stubRoute(
      restMatch(env, "POST", "conversation_events"),
      () => Response.json([], { status: 201 }),
    );
    const recordingList = stubRoute(
      (url, request) =>
        request.method === "GET" && url.pathname === "/v2/recordings",
      () => ({ data: [{ id: "rec-1" }] }),
    );
    const recordingDelete = stubRoute(
      (url, request) =>
        request.method === "DELETE" &&
        url.pathname === "/v2/recordings/rec-1",
      () => ({ data: {} }),
    );
    // D43: the pipeline resolves company/number/caller from the calls ROW
    // (keyed by session), not payload.to/from — call.recording.saved may not
    // carry them.
    const callsResolve = stubRoute(restMatch(env, "GET", "calls"), () => [
      { company_id: COMPANY_ID, phone_number_id: NUMBER_ID, caller_e164: CALLER },
    ]);
    // The voicemail leg is hung up after storing (cost backstop).
    const legHangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    serve(
      callsResolve,
      legHangup,
      mp3Fetch,
      storagePut,
      stamp,
      upsert,
      thread,
      eventScan,
      eventInsert,
      recordingList,
      recordingDelete,
    );

    await handleCallEvent(
      env,
      event("call.recording.saved", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        client_state: vmiState,
        from: CALLER,
        to: OUR_NUMBER,
        recording_urls: { mp3: "https://recordings.telnyx.example/rec-1.mp3" },
        recording_started_at: "2026-07-12T00:00:00Z",
        recording_ended_at: "2026-07-12T00:00:42Z",
      }),
    );

    // Stored under the company path, session-keyed (replay-safe upsert).
    expect(storagePut.calls[0].url.pathname).toBe(
      `/storage/v1/object/voicemails/${COMPANY_ID}/${SESSION}.mp3`,
    );
    // The calls row gets the recording pointer + duration.
    const vmStamp = stamp.calls.find(
      (c) =>
        (c.body as Record<string, unknown> | null)?.voicemail_seconds === 42,
    );
    expect(vmStamp).toBeDefined();
    // Outcome upgraded to 'voicemail' via the merge writer.
    const outcomeCall = upsert.calls.find(
      (c) =>
        (c.body as Record<string, unknown>).p_outcome === "voicemail",
    );
    expect(outcomeCall).toBeDefined();
    // Threaded with CREATE semantics + the voicemail timeline line landed.
    expect(thread.calls).toHaveLength(1);
    expect(
      (thread.calls[0].body as Record<string, unknown>).p_create_if_missing,
    ).toBe(true);
    expect(eventInsert.calls).toHaveLength(1);
    // Telnyx's copy is deleted after the fetch.
    expect(recordingDelete.calls).toHaveLength(1);
  });

  it("REPLAY after a prior store: recovers from OUR bucket (no re-fetch/re-upload), completes the writes, deletes the Telnyx copy last", async () => {
    // The calls row already has voicemail_path stamped (a prior pass stored it
    // but threw before threading) — recovery skips the Telnyx re-fetch.
    const callsResolve = stubRoute(restMatch(env, "GET", "calls"), () => [
      {
        company_id: COMPANY_ID,
        phone_number_id: NUMBER_ID,
        caller_e164: CALLER,
        voicemail_path: `${COMPANY_ID}/${SESSION}.mp3`,
        voicemail_seconds: 42,
      },
    ]);
    const mp3Fetch = stubRoute(
      (url) => url.hostname === "recordings.telnyx.example",
      () => new Response(new Uint8Array([1]), { status: 200 }),
    );
    const storagePut = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.pathname.startsWith("/storage/v1/object/voicemails/"),
      () => Response.json({ Key: "ok" }),
    );
    const legHangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    const upsert = upsertCallStub({ conversation_id: null });
    const thread = threadCallStub();
    const eventScan = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    const eventInsert = stubRoute(
      restMatch(env, "POST", "conversation_events"),
      () => Response.json([], { status: 201 }),
    );
    const recordingList = stubRoute(
      (url, request) =>
        request.method === "GET" && url.pathname === "/v2/recordings",
      () => ({ data: [{ id: "rec-1" }] }),
    );
    const recordingDelete = stubRoute(
      (url, request) =>
        request.method === "DELETE" && url.pathname === "/v2/recordings/rec-1",
      () => ({ data: {} }),
    );
    serve(
      callsResolve,
      mp3Fetch,
      storagePut,
      legHangup,
      upsert,
      thread,
      eventScan,
      eventInsert,
      recordingList,
      recordingDelete,
    );

    await handleCallEvent(
      env,
      event("call.recording.saved", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        client_state: vmiState,
        from: CALLER,
        to: OUR_NUMBER,
        recording_urls: { mp3: "https://recordings.telnyx.example/rec-1.mp3" },
        recording_started_at: "2026-07-12T00:00:00Z",
        recording_ended_at: "2026-07-12T00:00:42Z",
      }),
    );

    // Recovery path: NO Telnyx re-fetch, NO re-upload.
    expect(mp3Fetch.calls).toHaveLength(0);
    expect(storagePut.calls).toHaveLength(0);
    // The downstream writes still complete on the replay.
    expect(
      upsert.calls.some(
        (c) => (c.body as Record<string, unknown>).p_outcome === "voicemail",
      ),
    ).toBe(true);
    expect(eventInsert.calls).toHaveLength(1);
    // And only now is the Telnyx copy deleted (after the writes are durable).
    expect(recordingDelete.calls).toHaveLength(1);
  });

  it("a hangup-on-the-beep recording (under 2s) is discarded — the call stays an honest miss", async () => {
    const stamp = callsLinkStub();
    const recordingList = stubRoute(
      (url, request) =>
        request.method === "GET" && url.pathname === "/v2/recordings",
      () => ({ data: [] }),
    );
    const callsResolve = stubRoute(restMatch(env, "GET", "calls"), () => [
      { company_id: COMPANY_ID, phone_number_id: NUMBER_ID, caller_e164: CALLER },
    ]);
    const legHangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    serve(callsResolve, legHangup, stamp, recordingList);

    await handleCallEvent(
      env,
      event("call.recording.saved", {
        call_control_id: CC_ID,
        call_session_id: SESSION,
        client_state: vmiState,
        from: CALLER,
        to: OUR_NUMBER,
        recording_urls: { mp3: "https://recordings.telnyx.example/rec-2.mp3" },
        recording_started_at: "2026-07-12T00:00:00Z",
        recording_ended_at: "2026-07-12T00:00:01Z",
      }),
    );

    expect(
      stamp.calls.filter(
        (c) => (c.body as Record<string, unknown> | null)?.voicemail_seconds,
      ),
    ).toHaveLength(0);
  });
});

describe("handleCallEvent — outbound call.initiated (D43 nonce authorization)", () => {
  const OC_LEG = "oc-leg-1";
  const NONCE = "nonce-abc";
  const outboundInit = (nonce: string | null = NONCE) =>
    event("call.initiated", {
      call_control_id: OC_LEG,
      call_session_id: SESSION,
      direction: "outgoing",
      from: OUR_NUMBER, // the business number the browser presented
      to: CALLER, // the customer
      client_state: btoa(
        nonce ? `oc_customer|${CALLER}|${nonce}` : `oc_customer|${CALLER}`,
      ),
    });

  /** The single-use authorization RPC — the webhook's gate. */
  function authStub(
    result:
      | { authorized: false }
      | { authorized: true; company_id: string; phone_number_id: string; replay?: boolean },
  ): Stub {
    return stubRoute(
      rpcMatch(env, "api_authorize_outbound_call"),
      () => result,
    );
  }

  /** The defense-in-depth company read (keyed on the AUTHORIZED company) +
   *  its voice-usage RPC. */
  function outboundCompanyStubs(status: string, usedSeconds: number): Stub[] {
    return [
      stubRoute(
        restMatch(env, "GET", "companies", (url) => {
          const sel = url.searchParams.get("select") ?? "";
          return (
            sel.includes("overage_cap_multiplier") &&
            !sel.includes("call_screening") &&
            !sel.includes("mctb_message")
          );
        }),
        () => [
          {
            plan: "starter",
            current_period_start: "2026-07-01T00:00:00Z",
            overage_cap_multiplier: "3.00",
            subscription_status: status,
          },
        ],
      ),
      voiceSecondsStub(usedSeconds),
    ];
  }

  it("REJECTS a leg with NO valid authorization (forged/omitted/expired nonce, or a mismatched caller ID) — the RPC returns authorized:false", async () => {
    const action = telnyxV2Actions();
    // The RPC could not consume a matching nonce → not authorized.
    serve(authStub({ authorized: false }), action);

    await handleCallEvent(env, outboundInit("forged-or-stale"));

    expect(
      action.calls.some(
        (c) => c.url.pathname === `/v2/calls/${OC_LEG}/actions/hangup`,
      ),
    ).toBe(true);
  });

  it("REJECTS an UNTAGGED / nonce-less outgoing leg outright — no RPC call is even made", async () => {
    const action = telnyxV2Actions();
    // A raw oc_customer tag with NO nonce (a browser call crafted to bypass
    // /calls/browser) is rejected before the authorization RPC.
    serve(action);

    await handleCallEvent(env, outboundInit(null));

    expect(
      action.calls.some(
        (c) => c.url.pathname === `/v2/calls/${OC_LEG}/actions/hangup`,
      ),
    ).toBe(true);
  });

  it("REJECTS an authorized leg whose company is now OVER the voice cap (burst defense — keyed on the AUTHORIZED company)", async () => {
    const action = telnyxV2Actions();
    serve(
      authStub({
        authorized: true,
        company_id: COMPANY_ID,
        phone_number_id: NUMBER_ID,
      }),
      ...outboundCompanyStubs("active", 7500 * 60), // 2,500 × 3.00 cap, at it
      action,
    );

    await handleCallEvent(env, outboundInit());

    expect(
      action.calls.some(
        (c) => c.url.pathname === `/v2/calls/${OC_LEG}/actions/hangup`,
      ),
    ).toBe(true);
  });

  it("REJECTS an authorized leg whose subscription LAPSED between authorize and dial", async () => {
    const action = telnyxV2Actions();
    serve(
      authStub({
        authorized: true,
        company_id: COMPANY_ID,
        phone_number_id: NUMBER_ID,
      }),
      ...outboundCompanyStubs("canceled", 0),
      action,
    );

    await handleCallEvent(env, outboundInit());

    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/hangup")),
    ).toBe(true);
  });

  it("ALLOWS an authorized, under-cap, active call — stamps the customer leg ccid (the RPC already created the row)", async () => {
    const action = telnyxV2Actions();
    const meta = callsLinkStub();
    serve(
      authStub({
        authorized: true,
        company_id: COMPANY_ID,
        phone_number_id: NUMBER_ID,
      }),
      ...outboundCompanyStubs("active", 100 * 60),
      meta,
      action,
    );

    await handleCallEvent(env, outboundInit());

    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/hangup")),
    ).toBe(false);
    const ccidStamp = meta.calls.find(
      (c) =>
        (c.body as Record<string, unknown> | null)?.customer_call_control_id ===
        OC_LEG,
    );
    expect(ccidStamp).toBeDefined();
  });

  it("a REPLAY (authorized:true, replay:true) skips the cost re-check and just re-stamps idempotently", async () => {
    const action = telnyxV2Actions();
    const meta = callsLinkStub();
    // No company/cap stubs — the replay path must NOT read them.
    serve(
      authStub({
        authorized: true,
        company_id: COMPANY_ID,
        phone_number_id: NUMBER_ID,
        replay: true,
      }),
      meta,
      action,
    );

    await handleCallEvent(env, outboundInit());

    expect(
      action.calls.some((c) => c.url.pathname.endsWith("/hangup")),
    ).toBe(false);
    expect(meta.calls).toHaveLength(1);
  });
});

describe("handleCallEvent — terminal → text-back", () => {
  it("SECURITY: a forged OUTGOING inbound-family leg (browser spoofing a victim's number) is dropped — no billing, no thread, no text-back", async () => {
    // A member ORIGINATES an outgoing WebRTC leg, forges a `bri` (in_browser)
    // client_state with a 2020 answer stamp, and presents a VICTIM tenant's
    // number as `to`. Without the direction gate this would bill the victim
    // (~$34k), push them over their cap, and inject into their inbox.
    const callRecords = callRecordsInsertStub("cr-attack");
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    const sms = telnyxSms();
    serve(numberStub(), callRecords, upsert, thread, sms);

    await handleCallEvent(
      env,
      event("call.hangup", {
        call_control_id: "attacker-leg",
        call_session_id: "attack-sess",
        direction: "outgoing", // browser-ORIGINATED — never a real inbound call
        from: CALLER,
        to: OUR_NUMBER, // the victim's business number, spoofed as `to`
        hangup_cause: "normal_clearing",
        client_state: btoa(`bri|${CALLER}|2020-01-01T00:00:00.000Z`),
        start_time: "2020-01-01T00:00:00.000Z",
        end_time: "2026-07-12T00:00:00.000Z", // ~200M seconds if it billed
      }),
    );

    // The event is dropped before any billing / threading / text-back.
    expect(callRecords.calls).toHaveLength(0);
    expect(upsert.calls).toHaveLength(0);
    expect(thread.calls).toHaveLength(0);
    expect(sms.calls).toHaveLength(0);
  });

  it("SECURITY: a forged out_customer / forward leg with NO server-created calls row is dropped (tenant-from-`from` spoof)", async () => {
    // A member forges an oc_customer (or legacy mctb_forward) tag on a leg
    // presenting a VICTIM number as `from`. It was rejected at initiate so has
    // no calls row; the terminal handler must drop it, never bill/thread the
    // victim.
    const callRecords = callRecordsInsertStub("cr-attack2");
    const upsert = upsertCallStub();
    const noRow = stubRoute(restMatch(env, "GET", "calls"), () => []); // no genuine row
    serve(numberStub(), noRow, callRecords, upsert);

    for (const state of [`oc_customer|${CALLER}`, `mctb_forward|${CALLER}`]) {
      await handleCallEvent(
        env,
        event("call.hangup", {
          call_control_id: "attacker-leg-2",
          call_session_id: "attack-sess-2",
          direction: "outgoing",
          from: OUR_NUMBER, // victim number spoofed as caller ID
          to: CALLER,
          hangup_cause: "normal_clearing",
          client_state: btoa(state),
          start_time: "2020-01-01T00:00:00.000Z",
          end_time: "2026-07-12T00:00:00.000Z",
        }),
      );
    }

    expect(callRecords.calls).toHaveLength(0);
    expect(upsert.calls).toHaveLength(0);
  });

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

  it("#129/D43: an answered forward-leg hangup merges the session, threads it (CREATE — every inbound call reaches the inbox), and links the row", async () => {
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
    // D43 phase 3: EVERY inbound call threads with CREATE — answered calls
    // are threaded at answer time so notes can happen mid-call, and the
    // hangup pass converges idempotently with the same semantics.
    expect(thread.calls).toHaveLength(1);
    expect(thread.calls[0].body).toMatchObject({
      p_outcome: "answered",
      p_forward_seconds: 272,
      p_create_if_missing: true,
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
    // D43: out_customer talk time anchors on calls.answered_at (stamped at
    // customer pickup), NEVER ring time. Here the customer answered instantly.
    const answeredAt = stubRoute(restMatch(env, "GET", "calls"), () => [
      { answered_at: "2026-07-04T10:00:00.000Z" },
    ]);
    serve(
      numberStub(),
      answeredAt,
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
