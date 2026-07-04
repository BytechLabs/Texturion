/**
 * Missed-call text-back (FEATURE-GAPS voice wave, Step 1). Two suites:
 *   1. computeMissedFromEvent — the PURE "missed" computation over Call-Control
 *      events (dial timeout + AMD result → missed; human answered → not missed).
 *   2. sendMissedCallText — on computed-missed + mctb_enabled, routes ONE
 *      booking-forward SMS through the shared guard (claim_missed_call_text),
 *      dispatches it via Telnyx, and fires the crew-wide alert. Only the network
 *      edge (global fetch) is stubbed.
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
  return [gatesCompany, registrations];
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
    serve(company, ...gates, claim, telnyx, persist, ...alertStubs());

    await run();

    // The RPC got the MERGE-APPLIED body ({business_name} → Ace Plumbing) and
    // the per-call id for idempotency.
    expect(claim.calls).toHaveLength(1);
    expect(claimBody?.p_body).toContain("Ace Plumbing");
    expect(claimBody?.p_call_id).toBe(CALL_ID);
    expect(claimBody?.p_caller_e164).toBe(CALLER);
    // Dispatched via Telnyx from our number to the caller.
    expect(telnyx.calls).toHaveLength(1);
    expect(telnyx.calls[0].body).toMatchObject({ from: OUR_NUMBER, to: CALLER });
  });

  it("does nothing when mctb is disabled (no further work)", async () => {
    const company = mctbCompanyStub({ mctb_enabled: false });
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, claim);
    await run();
    expect(claim.calls).toHaveLength(0);
  });

  it("does nothing when enabled but the message is unauthored", async () => {
    const company = mctbCompanyStub({ mctb_message: null });
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({}));
    serve(company, claim);
    await run();
    expect(claim.calls).toHaveLength(0);
  });

  it("a retried webhook (duplicate) never double-texts or alerts", async () => {
    const company = mctbCompanyStub();
    const gates = sendGateStubs();
    const telnyx = telnyxStub();
    const claim = stubRoute(rpcMatch(env, "claim_missed_call_text"), () => ({
      skipped: "duplicate",
    }));
    serve(company, ...gates, claim, telnyx);
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
    serve(company, ...gates, claim, telnyx);
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
    serve(company, claim);
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
    const members = stubRoute(restMatch(env, "GET", "company_members"), () => [
      { user_id: "99999999-9999-4999-8999-999999999999" },
    ]);
    const prefs = stubRoute(
      restMatch(env, "GET", "notification_prefs"),
      // Email on, push off — the email copy is the assertion target.
      () => [
        {
          user_id: "99999999-9999-4999-8999-999999999999",
          email_enabled: true,
          push_enabled: false,
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
    const authUser = stubRoute(
      (url, request) =>
        request.method === "GET" && url.pathname.startsWith("/auth/v1/admin/users/"),
      () => ({ user: { id: "99999999-9999-4999-8999-999999999999", email: "crew@acme.example" } }),
    );
    let emailBody: string | undefined;
    const resend = stubRoute(
      (url, request) =>
        request.method === "POST" && url.href === "https://api.resend.com/emails",
      (c) => {
        emailBody = (c.body as { text?: string }).text;
        return { id: "email-1" };
      },
    );
    serve(company, ...gates, claim, telnyx, persist, conv, members, prefs, authUser, resend);

    await run();

    expect(emailBody).toBeDefined();
    expect(emailBody).toContain("didn't go through");
    expect(emailBody).not.toContain("We sent them a text");
  });
});
