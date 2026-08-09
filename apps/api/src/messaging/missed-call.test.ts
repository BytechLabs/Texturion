/**
 * Missed-call text-back (FEATURE-GAPS voice wave, Step 1). Two suites:
 *   1. computeMissedFromEvent — the PURE "missed" computation over Call-Control
 *      events (dial timeout + AMD result → missed; human answered → not missed).
 *   2. sendMissedCallText — on computed-missed + mctb_enabled, routes ONE
 *      booking-forward SMS through the shared guard (claim_missed_call_text),
 *      dispatches it via Telnyx, and fires the crew-wide alert. Only the network
 *      edge (global fetch) is stubbed.
 */
import {
  applyMergeFields,
  DEFAULT_MCTB_MESSAGE,
} from "@loonext/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import {
  messageRow,
  restMatch,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { computeMissedFromEvent, sendMissedCallText } from "./missed-call";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const OUR_NUMBER = "+16135550100";
const CALLER = "+16135551000";
const CALL_ID = "call-session-abc";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("computeMissedFromEvent — the missed computation", () => {
  it("forward leg rings out (hangup timeout) → MISSED", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.hangup",
        hangupCause: "timeout",
        leg: "forward",
      }),
    ).toEqual({ missed: true });
  });

  it("forward leg AMD 'machine' (voicemail) → MISSED", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.machine.detection.ended",
        amdResult: "machine",
        leg: "forward",
      }),
    ).toEqual({ missed: true });
  });

  it("forward leg AMD 'human' → NOT missed (person answered)", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.machine.detection.ended",
        amdResult: "human",
        leg: "forward",
      }),
    ).toEqual({ missed: false, reason: "human_answered" });
  });

  it("forward leg busy/rejected → MISSED", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.hangup",
        hangupCause: "busy",
        leg: "forward",
      }),
    ).toEqual({ missed: true });
  });

  it("forward leg normal hangup after a human spoke → NOT missed", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.hangup",
        hangupCause: "normal_clearing",
        leg: "forward",
      }),
    ).toEqual({ missed: false, reason: "human_answered" });
  });

  it("the forwarded inbound leg's hangup → NOT the decider", () => {
    // The inbound leg of a forwarded call carries the 'mctb_inbound_fwd' tag;
    // only the forward leg's terminal signal decides — never double-fire.
    expect(
      computeMissedFromEvent({
        eventType: "call.hangup",
        hangupCause: "normal_clearing",
        leg: "inbound_forwarded",
      }),
    ).toEqual({ missed: false, reason: "inbound_leg" });
  });

  it("untagged inbound leg (no-forward path): hangup → MISSED immediately", () => {
    // Nobody could answer live, so the caller's hangup is a missed call.
    expect(
      computeMissedFromEvent({
        eventType: "call.hangup",
        hangupCause: "normal_clearing",
        leg: "inbound_untagged",
      }),
    ).toEqual({ missed: true });
  });

  it("call.initiated / call.answered are never terminal", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.answered",
        leg: "inbound_untagged",
      }),
    ).toEqual({ missed: false, reason: "not_terminal" });
  });

  it("AMD 'not_sure' waits for the hangup (not terminal)", () => {
    expect(
      computeMissedFromEvent({
        eventType: "call.machine.detection.ended",
        amdResult: "not_sure",
        leg: "forward",
      }),
    ).toEqual({ missed: false, reason: "not_terminal" });
  });
});

/** companies MCTB-settings lookup stub. */
function mctbCompanyStub(
  overrides: {
    mctb_enabled?: boolean;
    mctb_message?: string | null;
    forward_to_cell?: string | null;
  } = {},
): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "companies",
      (url) => url.searchParams.get("select")?.includes("mctb_enabled") ?? false,
    ),
    () => [
      {
        name: "Ace Plumbing",
        mctb_enabled: overrides.mctb_enabled ?? true,
        mctb_message:
          "mctb_message" in overrides
            ? overrides.mctb_message
            : "Sorry we missed your call, {business_name} here — reply with your address and we'll book you in.",
        forward_to_cell: overrides.forward_to_cell ?? null,
        subscription_status: "active",
      },
    ],
  );
}

/**
 * #307: the line's own name, toggle and text, read ALONGSIDE the company row
 * rather than after it — a line can switch the text-back on for itself, which
 * is unknowable while the toggle is read before the number is. Null on every
 * override is every number until somebody sets one, so this stub's default is
 * the production reality on deploy day.
 */
function numberStub(
  label: string | null = null,
  overrides: {
    mctb_enabled?: boolean | null;
    mctb_message?: string | null;
  } = {},
): Stub {
  return stubRoute(
    restMatch(
      env,
      "GET",
      "phone_numbers",
      (url) => url.searchParams.get("select")?.includes("label") ?? false,
    ),
    // #307: null on the overrides is every number until somebody sets one,
    // and null must resolve to the workspace's value.
    () => [{ label, mctb_enabled: null, mctb_message: null, ...overrides }],
  );
}

/** getSendGates: registration companies select + messaging_registrations. */
function sendGateStubs(): Stub[] {
  const gatesCompany = stubRoute(
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
  );
  const registrations = stubRoute(
    restMatch(env, "GET", "messaging_registrations"),
    () => [],
  );
  // The pre-send gates end with the opt-out check: nobody in these fixtures
  // has opted out.
  const optOuts = stubRoute(restMatch(env, "GET", "opt_outs"), () => []);
  // #228: the caller's language, read only once a text is actually going out.
  // No rows is the ordinary case for a missed call - the number belongs to
  // somebody with no contact record - and it resolves to the workspace
  // language, which is the right answer for a stranger.
  const callerLocale = stubRoute(restMatch(env, "GET", "contacts"), () => []);
  return [gatesCompany, registrations, optOuts, callerLocale];
}

function telnyxStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: "telnyx-mctb-1" } }),
  );
}

/** Notification pipeline stubs (members, prefs, subs, conversation for alert). */
function alertStubs(): Stub[] {
  const conv = stubRoute(
    restMatch(
      env,
      "GET",
      "conversations",
      (url) => url.searchParams.get("select")?.includes("assigned_user_id") ?? false,
    ),
    () => [
      {
        id: CONVERSATION_ID,
        assigned_user_id: null,
        contacts: { name: null, phone_e164: CALLER },
      },
    ],
  );
  const members = stubRoute(
    restMatch(env, "GET", "company_members"),
    () => [],
  );
  const prefs = stubRoute(
    restMatch(env, "GET", "notification_prefs"),
    () => [],
  );
  return [conv, members, prefs];
}

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function run(callerE164 = CALLER) {
  const db = getDb(env);
  return sendMissedCallText(env, db, {
    companyId: COMPANY_ID,
    phoneNumberId: NUMBER_ID,
    fromNumberE164: OUR_NUMBER,
    callerE164,
    callId: CALL_ID,
  });
}

describe("sendMissedCallText — text-back + alert", () => {
  it("sends one merged booking-forward SMS through the guard and alerts the crew", async () => {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, numberStub(), ...gates, claim, telnyx, persist, ...alertStubs());

    await run();

    // The RPC got the MERGE-APPLIED body ({business_name} → Ace Plumbing) and
    // the per-call id for idempotency.
    expect(claim.calls).toHaveLength(1);
    expect(claimBody?.p_body).toContain("Ace Plumbing");
    // #192: the owner's non-blank message OVERRIDES the product default.
    expect(claimBody?.p_body).toContain("we'll book you in");
    expect(claimBody?.p_body).not.toContain(
      "Reply here with your address and what you need",
    );
    expect(claimBody?.p_call_id).toBe(CALL_ID);
    expect(claimBody?.p_caller_e164).toBe(CALLER);
    // Dispatched via Telnyx from our number to the caller.
    expect(telnyx.calls).toHaveLength(1);
    expect(telnyx.calls[0].body).toMatchObject({ from: OUR_NUMBER, to: CALLER });
  });

  it("does nothing when mctb is disabled (no further work)", async () => {
    const company = mctbCompanyStub({ mctb_enabled: false });
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, numberStub(), claim);
    await run();
    expect(claim.calls).toHaveLength(0);
  });

  it("enabled with NO owner message sends the PRODUCT DEFAULT (#192 fallback)", async () => {
    const company = mctbCompanyStub({ mctb_message: null });
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, numberStub(), ...gates, claim, telnyx, persist, ...alertStubs());

    await run();

    // The default template ships, merge-applied, byte-for-byte — an enabled
    // text-back never silently sends nothing.
    expect(claim.calls).toHaveLength(1);
    expect(claimBody?.p_body).toBe(
      applyMergeFields(DEFAULT_MCTB_MESSAGE, {
        contactName: null,
        businessName: "Ace Plumbing",
      }),
    );
    expect(telnyx.calls).toHaveLength(1);
  });

  it("a WHITESPACE-ONLY owner message also falls back to the default (#192)", async () => {
    const company = mctbCompanyStub({ mctb_message: "   \n  " });
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, numberStub(), ...gates, claim, telnyx, persist, ...alertStubs());

    await run();

    expect(claim.calls).toHaveLength(1);
    expect(claimBody?.p_body).toBe(
      applyMergeFields(DEFAULT_MCTB_MESSAGE, {
        contactName: null,
        businessName: "Ace Plumbing",
      }),
    );
  });

  it("a retried webhook (duplicate) never double-texts or alerts", async () => {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
      skipped: "duplicate",
    }));
    serve(company, numberStub(), ...gates, claim, telnyx);
    await run();
    expect(claim.calls).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(0); // no dispatch on a duplicate
  });

  it("honors the opt-out mirror via the guard (no dispatch)", async () => {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
      skipped: "recipient_opted_out",
    }));
    serve(company, numberStub(), ...gates, claim, telnyx);
    await run();
    expect(claim.calls).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(0);
  });

  it("skips an anonymous / non-US-CA caller SILENTLY (no gates, no throw)", async () => {
    // CLIR callers arrive as 'anonymous'; internationals as non-NANP E.164.
    // Neither can be texted — a throw here would burn 5 ledger retries + a
    // Sentry page on a condition known final on the first pass.
    const company = mctbCompanyStub();
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, numberStub(), claim);
    await run("anonymous");
    await run("+447911123456");
    expect(claim.calls).toHaveLength(0);
  });

  it("a Telnyx send failure alerts the crew with FAILURE copy, never 'we texted them'", async () => {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    // Telnyx rejects the send (dispatchOutbound persists 'failed', no throw).
    const telnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () => new Response(JSON.stringify({ errors: [{ code: "40300" }] }), { status: 403 }),
    );
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
      message: messageRow({ status: "queued" }),
      conversation_id: CONVERSATION_ID,
      created_conversation: true,
    }));
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ status: "failed", telnyx_message_id: null })],
    );
    // Capture the alert email to a single member.
    // `role` is not decoration: the audience filter asks whether the member
    // can read conversations at all (#581), and a row without one fails CLOSED —
    // the production query selects `user_id,role`, so a fixture that omits it is
    // describing a member who cannot exist.
    const members = stubRoute(restMatch(env, "GET", "company_members"), () => [
      { user_id: "99999999-9999-4999-8999-999999999999", role: "member" },
    ]);
    const prefs = stubRoute(
      restMatch(env, "GET", "notification_prefs"),
      // Push on — D45: missed-call alerts are push-only, so the truthful
      // FAILURE copy is asserted on the (plaintext) FCM payload.
      () => [
        {
          user_id: "99999999-9999-4999-8999-999999999999",
          push_enabled: true,
        },
      ],
    );
    const webSubs = stubRoute(
      restMatch(env, "GET", "push_subscriptions"),
      () => [],
    );
    const deviceTokens = stubRoute(
      restMatch(env, "GET", "device_push_tokens"),
      () => [
        {
          id: "40000000-aaaa-4000-8000-000000000001",
          user_id: "99999999-9999-4999-8999-999999999999",
          platform: "android",
          token: "tok-a",
        },
      ],
    );
    const conv = stubRoute(
      restMatch(
        env,
        "GET",
        "conversations",
        (url) => url.searchParams.get("select")?.includes("assigned_user_id") ?? false,
      ),
      () => [
        { id: CONVERSATION_ID, assigned_user_id: null, contacts: { name: null, phone_e164: CALLER } },
      ],
    );
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(
      ...[company, numberStub(), ...gates, claim, telnyx, persist, conv, members, prefs, webSubs, deviceTokens]
        .map((s) => s.route as FetchRoute),
      ...service.routes,
    );

    // Same env, FCM configured — the alert rides the native push leg (D45:
    // no email exists to carry the failure copy anymore).
    const alertEnv = fcmEnv(account);
    await sendMissedCallText(alertEnv, getDb(alertEnv), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });

    const data = service.sends[0]?.message.data as
      | Record<string, string>
      | undefined;
    expect(data).toBeDefined();
    expect(data!.body).toBe("Their text-back failed. Call them back.");
    expect(data!.body).not.toContain("We texted them");
  });
});

/**
 * #307 — the text-back is signed by the line that was rung.
 *
 * MC-1 is the deploy-day guarantee; MC-3 is the one the sweep demanded, after
 * the same hole appeared twice on the greeting and away paths: a stub returns
 * the column whatever the select asks for, so every other assertion passes
 * against a query that never fetched it.
 */
describe("#307 the text-back names the line", () => {
  async function bodyFor(label: string | null): Promise<string> {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, numberStub(label), ...gates, claim, telnyx, persist, ...alertStubs());

    await sendMissedCallText(env, getDb(env), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });
    return String(claimBody?.p_body ?? "");
  }

  it("MC-1: a line with no name of its own signs with the workspace's", async () => {
    expect(await bodyFor(null)).toContain("Ace Plumbing");
  });

  it("MC-2: a named line signs with its own name", async () => {
    // The coherence: this caller just heard "Ace Plumbing Sales" on the
    // greeting. A text signed "Ace Plumbing" is a second business.
    expect(await bodyFor("Ace Plumbing Sales")).toContain("Ace Plumbing Sales");
  });

  it("MC-3: the line's name is actually fetched", async () => {
    const company = mctbCompanyStub();
    const number = numberStub("Ace Plumbing Sales");
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
      message: messageRow({ status: "queued" }),
      conversation_id: CONVERSATION_ID,
      created_conversation: true,
    }));
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, number, ...gates, claim, telnyx, persist, ...alertStubs());

    await sendMissedCallText(env, getDb(env), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });

    expect(number.calls, "the number row was never read").toHaveLength(1);
    expect(number.calls[0].url.searchParams.get("id")).toBe(`eq.${NUMBER_ID}`);
  });

  it("MC-5: a failed name lookup still sends the text", async () => {
    // Best-effort by construction, and unproven until now: the stub always
    // succeeded, so the catch never ran and `throw cause` in it broke
    // nothing. A caller who has just been missed should get the reply even
    // if we could not read what to sign it with.
    const company = mctbCompanyStub();
    const number = stubRoute(
      restMatch(env, "GET", "phone_numbers", (url) =>
        url.searchParams.get("select")?.includes("label") ?? false,
      ),
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (c) => {
      claimBody = c.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-1" })],
    );
    serve(company, number, ...gates, claim, telnyx, persist, ...alertStubs());

    await expect(
      sendMissedCallText(env, getDb(env), {
        companyId: COMPANY_ID,
        phoneNumberId: NUMBER_ID,
        fromNumberE164: OUR_NUMBER,
        callerE164: CALLER,
        callId: CALL_ID,
      }),
    ).resolves.toBeDefined();

    // And it signed with the workspace name rather than nothing.
    expect(String(claimBody?.p_body ?? "")).toContain("Ace Plumbing");
  });

  it("MC-4: a disabled workspace sends nothing", async () => {
    // #307 changed WHERE this is decided. The number is now read alongside the
    // company rather than after it, because a line can switch the text-back on
    // for itself — which is unknowable while the toggle is read before the
    // number is. So this no longer asserts the read order; it asserts the
    // outcome, which is what a caller experiences either way.
    const company = mctbCompanyStub({ mctb_enabled: false });
    const number = numberStub("Ace Plumbing Sales");
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, number, claim);

    await sendMissedCallText(env, getDb(env), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });

    expect(claim.calls).toHaveLength(0);
  });

  it("MC-5: a line that switched the text-back OFF stays silent", async () => {
    // The yard-sign number in #307's Scope. A tracked number is missed for a
    // different reason than the office line, and the owner may want no text at
    // all from it — which no company-wide toggle can express.
    const company = mctbCompanyStub({ mctb_enabled: true });
    const number = numberStub("Ace Plumbing Sales", { mctb_enabled: false });
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, number, ...sendGateStubs(), claim);

    await sendMissedCallText(env, getDb(env), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });

    expect(claim.calls).toHaveLength(0);
  });

  it("MC-6: a line sends its OWN text, not the workspace's", async () => {
    // The other half: a sales line that answers differently from the service
    // line. Signing a sales caller's text with the service line's words is the
    // "two businesses in one interaction" failure the issue opens with.
    const company = mctbCompanyStub({
      mctb_enabled: true,
      mctb_message: "Sorry we missed you — the office opens at 8.",
    });
    const number = numberStub("Ace Plumbing Sales", {
      mctb_message: "Thanks for calling sales. We will ring you right back.",
    });
    let claimBody: Record<string, unknown> | undefined;
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), (call) => {
      claimBody = call.body as Record<string, unknown>;
      return {
        message: messageRow({ status: "queued" }),
        conversation_id: CONVERSATION_ID,
        created_conversation: true,
      };
    });
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [messageRow({ telnyx_message_id: "telnyx-mctb-n6" })],
    );
    serve(
      company,
      number,
      ...sendGateStubs(),
      telnyxStub(),
      ...alertStubs(),
      claim,
      persist,
    );

    await sendMissedCallText(env, getDb(env), {
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      fromNumberE164: OUR_NUMBER,
      callerE164: CALLER,
      callId: CALL_ID,
    });

    expect(claim.calls).toHaveLength(1);
    expect(String(claimBody?.p_body ?? "")).toContain("Thanks for calling sales");
    expect(String(claimBody?.p_body ?? "")).not.toContain("opens at 8");
  });
});
