/**
 * Call-Control glue coverage (calls-v3). Every inbound and outbound CALL is a
 * CallSessionDO session (session-do.test.ts owns that), so this suite pins what
 * lives in voice-webhook.ts:
 *   - the #211 outbound tag helpers (buildOutboundState / parseOutboundSessionId);
 *   - the SHARED voicemail pipeline (handleVoicemailSaved) the DO drives — fetch,
 *     store, thread, delete the Telnyx copy, replay recovery, under-2s discard;
 *   - the SHARED terminal merge (handleTerminalCallEvent, reached via the
 *     consult/transfer webhook entry handleCallEvent): billing, threading, the
 *     missed text-back, and the tenant-forgery drop;
 *   - the #132 crew alert without a text-back.
 * Only the network edge (global fetch) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
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
  handleVoicemailSaved,
  buildOutboundState,
  FORWARD_LEG_STATE,
  INBOUND_FORWARDED_STATE,
  OUTBOUND_CUSTOMER_STATE,
  parseOutboundSessionId,
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
 * Every terminal event feeds the #129 calls read model, so its three stubs are
 * served by DEFAULT (appended last — a test's own upsert/thread/link stub,
 * passed explicitly, wins by order). A GET call_member_legs default (→ none) and
 * a generic call-action stub are kept as harmless defaults. Everything else
 * still fails loudly when unstubbed.
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

/** call.recording.saved is a vmi session-family event owned by the CallSessionDO
 *  (its voicemail-pipeline effect calls handleVoicemailSaved via runtime.ts).
 *  These tests exercise that SHARED storage delegate directly — the same code
 *  path the DO drives — rather than a legacy handleCallEvent dispatch. */
function runRecordingSaved(ev: TelnyxEvent): Promise<void> {
  return handleVoicemailSaved(
    env,
    getDb(env),
    (ev.data?.payload ?? {}) as never,
  );
}

describe("#211 outbound tag parsing (buildOutboundState / parseOutboundSessionId)", () => {
  const S = "11111111-1111-4111-8111-111111111111";

  it("4-part round-trip: builds oc_customer|<cust>|<nonce>|<S> and parses part-4 as S", () => {
    const tag = buildOutboundState(OUTBOUND_CUSTOMER_STATE, "+15551234567", "nonce-1", S);
    expect(atob(tag).split("|")).toEqual(["oc_customer", "+15551234567", "nonce-1", S]);
    expect(parseOutboundSessionId(tag)).toBe(S);
  });

  it("a tag with no part-4 (a short/stray shape) has no session id — never keyed on", () => {
    const tag = btoa("oc_customer|+15551234567|nonce-1");
    expect(parseOutboundSessionId(tag)).toBeNull();
  });

  it("a malformed part-4 (not a UUID) parses to null — never keyed on", () => {
    const tag = btoa("oc_customer|+15551234567|nonce-1|not-a-uuid");
    expect(parseOutboundSessionId(tag)).toBeNull();
  });

  it("a non-oc tag (bri) parses to null", () => {
    expect(parseOutboundSessionId(btoa("bri||2026-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("handleVoicemailSaved — D43 voicemail pipeline", () => {
  const vmiState = btoa(`vmi|${CALLER}`);

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

    await runRecordingSaved(
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

    await runRecordingSaved(
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

    await runRecordingSaved(
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

describe("handleCallEvent — terminal → text-back", () => {
  it("SECURITY: a forged OUTGOING inbound-family leg (browser spoofing a victim's number) is dropped — no billing, no thread, no text-back", async () => {
    // A member ORIGINATES an outgoing WebRTC leg, forges a `bri` (in_browser)
    // client_state with a 2020 answer stamp, and presents a VICTIM tenant's
    // number as `to`. Without the gate this would bill the victim (~$34k), push
    // them over their cap, and inject into their inbox. A forged leg was
    // rejected at initiate, so it has NO genuine server-created calls row — the
    // terminal handler drops it on that (the unforgeable proof; `direction` is
    // unreliable — Telnyx omits it on an answered leg's later events).
    const callRecords = callRecordsInsertStub("cr-attack");
    const upsert = upsertCallStub();
    const thread = threadCallStub();
    const sms = telnyxSms();
    const noRow = stubRoute(restMatch(env, "GET", "calls"), () => []); // no genuine row
    serve(numberStub(), noRow, callRecords, upsert, thread, sms);

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

  it("SECURITY: an untagged OUTGOING call.initiated to a PSTN number is HUNG UP (the outbound authorization gate)", async () => {
    // A member with a Telnyx WebRTC credential bypasses POST /v1/calls/browser
    // and places a call directly with no (or a junk) client_state to a PSTN
    // number. A valid 4-part oc leg would have routed to the DO, so reaching
    // handleCallEvent proves this leg was never authorized (no cap /
    // subscription / number-ownership / NANP check) - it must be hung up.
    const hangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    serve(hangup);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: "unauth-pstn-leg",
        direction: "outgoing",
        to: "+19005551234", // a PSTN number, no valid oc tag
        client_state: undefined,
      }),
    );

    expect(hangup.calls).toHaveLength(1);
    expect(hangup.calls[0].url.pathname).toContain("unauth-pstn-leg");
  });

  it("SECURITY: an OUTGOING leg to a Telnyx credential URI is NOT hung up (our own member/consult/transfer legs)", async () => {
    // Legs WE place (member ring, consult, transfer) dial a credential URI
    // (sip:<username>@sip.telnyx.com, non-numeric user) - allowed. Only PSTN
    // targets are gated, so a browser cannot reach the carrier by crafting
    // sip:+1...@sip.telnyx.com (that has a numeric user and is rejected).
    const hangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
    serve(hangup);

    await handleCallEvent(
      env,
      event("call.initiated", {
        call_control_id: "our-member-leg",
        direction: "outgoing",
        to: "sip:gencred_x@sip.telnyx.com",
        client_state: undefined,
      }),
    );

    expect(hangup.calls).toHaveLength(0);
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

  it("REGRESSION (#135): a genuine voicemail-leg hangup with NO `direction` still resolves (Telnyx omits it on answered legs)", async () => {
    // The exact prod wedge: a caller reaches voicemail, hangs up, and Telnyx's
    // call.hangup for the (answered) vm_inbound leg carries NO `direction`. The
    // old `direction === 'incoming'` gate dropped it → the calls row stayed
    // outcome-null → the line wedged 4h → later inbound calls skipped the ring.
    // The genuine calls row (default stub) must let it resolve + text-back.
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
        // NO `direction` — as Telnyx delivers it on the voicemail leg's hangup.
        from: CALLER,
        to: OUR_NUMBER,
        hangup_cause: "normal_clearing",
        client_state: btoa(`vmi|${CALLER}|2026-07-12T00:00:00.000Z`),
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
