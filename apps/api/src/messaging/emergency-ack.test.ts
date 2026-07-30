/**
 * #414 ask 4 — the acknowledgment sent to someone who replied URGENT.
 *
 * The ask is narrow and the wording carries it: never reassure, always name
 * the alternative. Most of what is tested here is therefore the message
 * itself, because the message IS the feature — a body that drifts into "we'll
 * call you shortly" would pass every structural test and fail the issue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMERGENCY_SAFETY_LINE,
  emergencyReplyBody,
} from "@loonext/shared";

import { getDb } from "../db";
import type { Env } from "../env";
import {
  messageRow,
  restMatch,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  EMERGENCY_ACK_BODY,
  EMERGENCY_ACK_DAILY_CAP,
  EMERGENCY_ACK_THROTTLE_SECONDS,
  emergencyAckSegments,
  sendEmergencyAcknowledgment,
} from "./emergency-ack";

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const NUMBER = "+16135550100";
const CONTACT = "+16135551000";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what the message actually says (#414 ask 4)", () => {
  it("never promises a human", () => {
    // "We'll call you shortly" sent by a robot to someone with a gas smell is
    // the exact thing the issue forbids. If this test fails, the feature has
    // become the defect it was written to fix.
    const forbidden = [
      /we'?ll call/i,
      /someone will/i,
      /shortly/i,
      /right away we/i,
      /on (our|the) way/i,
      /expect a call/i,
    ];
    for (const pattern of forbidden) {
      expect(EMERGENCY_ACK_BODY).not.toMatch(pattern);
    }
  });

  it("names the alternative, which is the ask's actual requirement", () => {
    expect(EMERGENCY_ACK_BODY).toMatch(/911/);
  });

  it("names no trade — #460", () => {
    // The old wording said "if you smell gas, call 911 or your utility's
    // emergency line", which is a plumber's sentence auto-sent by locksmiths,
    // landscapers and mobile mechanics. A default is what most workspaces
    // actually send, so a default naming somebody else's trade is the product
    // putting words in an owner's mouth.
    for (const pattern of [/gas/i, /utility/i, /heat/i, /pipe/i, /furnace/i]) {
      expect(EMERGENCY_ACK_BODY).not.toMatch(pattern);
    }
  });

  it("keeps the safety line whatever the owner writes — #460", () => {
    // THE safety property, now that the body is owner-authored. #414 ask 4
    // survives as one non-removable sentence rather than as ownership of the
    // whole message, so this is the assertion standing between an owner and a
    // reply that promises a callback nobody will make.
    const hostile = [
      "We'll call you right back, promise!",
      "", // blank falls back to the product default
      "   ",
      "URGENT received.",
    ];
    for (const owner of hostile) {
      expect(emergencyReplyBody(owner)).toContain(EMERGENCY_SAFETY_LINE);
    }
  });

  it("does not say it twice when the owner pastes it in — #460", () => {
    // They WILL paste it: the settings preview shows the composed message, and
    // copying it is the obvious way to start writing your own. Two "call 911"s
    // in one message reads as a broken robot at the moment it most needs to be
    // believed.
    const pasted = `Flagged as urgent. ${EMERGENCY_SAFETY_LINE}`;
    const composed = emergencyReplyBody(pasted);
    expect(composed).toBe(pasted);
    expect(composed.split(EMERGENCY_SAFETY_LINE)).toHaveLength(2);
  });

  it("confirms the word worked, so the instruction was not for nothing", () => {
    expect(EMERGENCY_ACK_BODY).toMatch(/urgent/i);
  });

  it("tells them not to wait on us, which is what makes it honest", () => {
    expect(EMERGENCY_ACK_BODY).toMatch(/do not wait|don't wait/i);
  });

  it("is one GSM-7 segment", () => {
    // A person reading this on a cracked phone in a cold house should not get
    // it in two pieces that arrive out of order. Non-GSM7 punctuation (a
    // curly apostrophe, an em dash) silently halves the segment budget, so
    // this pins the outcome rather than the character set.
    expect(emergencyAckSegments()).toBe(1);
    expect(EMERGENCY_ACK_BODY.length).toBeLessThanOrEqual(160);
  });
});

function conversationStub(numberStatus = "active"): Stub {
  return stubRoute(
    restMatch(env, "GET", "conversations"),
    () => [
      {
        id: CONVERSATION_ID,
        phone_numbers: { number_e164: NUMBER, status: numberStatus },
        contacts: { phone_e164: CONTACT },
      },
    ],
  );
}

/** getSendGates: registration companies select + messaging_registrations. */
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
    stubRoute(restMatch(env, "GET", "opt_outs"), () => []),
  ];
}

function send(routes: Stub[], triggerBody = "URGENT no heat") {
  stubFetch(...[...routes, ...sendGateStubs()].map((r) => r.route));
  return sendEmergencyAcknowledgment(env, getDb(env), {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    fromE164: CONTACT,
    triggerBody,
  });
}

describe("the claim it routes through", () => {
  it("uses its OWN claim, not the away reply's", async () => {
    // Sharing claim_auto_reply would mean an away reply sent ten minutes ago
    // silently swallows the emergency acknowledgment — a throttle meant for a
    // different message eating the one that matters.
    const conv = conversationStub();
    const away = stubRoute(rpcMatch(env, "claim_auto_reply"), () => ({}));
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), (call) => {
      expect(call.body).toMatchObject({
        p_company_id: COMPANY_ID,
        p_conversation_id: CONVERSATION_ID,
        p_throttle_seconds: EMERGENCY_ACK_THROTTLE_SECONDS,
        p_daily_cap: EMERGENCY_ACK_DAILY_CAP,
      });
      return { skipped: "throttled" };
    });

    const outcome = await send([conv, claim, away]);

    expect(outcome).toEqual({ sent: false, reason: "throttled" });
    expect(claim.calls).toHaveLength(1);
    expect(away.calls).toHaveLength(0);
  });

  it("carries a daily cap, because it is exempt from the overage cap", async () => {
    // An exempt send path with no ceiling of its own is an uncapped cost
    // centre. The cap is the replacement, so it must actually be sent.
    expect(EMERGENCY_ACK_DAILY_CAP).toBeGreaterThan(0);
    const conv = conversationStub();
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), () => ({
      skipped: "daily_cap",
    }));
    const outcome = await send([conv, claim]);
    expect(outcome).toEqual({ sent: false, reason: "daily_cap" });
  });

  it("stays silent when the owner turned the mechanism off", async () => {
    const conv = conversationStub();
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), () => ({
      skipped: "emergency_disabled",
    }));
    const outcome = await send([conv, claim]);
    expect(outcome).toEqual({ sent: false, reason: "emergency_disabled" });
  });

  it("sends nothing when there is no active number to send from", async () => {
    const conv = conversationStub("pending");
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), () => ({}));
    const outcome = await send([conv, claim]);
    expect(outcome).toEqual({ sent: false, reason: "not_found" });
    expect(claim.calls).toHaveLength(0);
  });
});

describe("an emergency is the one auto-send that may answer URGENT", () => {
  it("is NOT suppressed by the emergency short-circuit it exists to answer", async () => {
    const conv = conversationStub();
    const queued = messageRow({ status: "queued", segments: 1 });
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), () => ({
      message: queued,
    }));
    const telnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () => ({ data: { id: "telnyx-emergency-1" } }),
    );
    const persist = stubRoute(
      (url, request) =>
        request.method === "PATCH" && url.pathname === "/rest/v1/messages",
      () => [{ ...queued, telnyx_message_id: "telnyx-emergency-1" }],
    );

    const outcome = await send([conv, claim, telnyx, persist]);

    expect(outcome.sent).toBe(true);
    expect(telnyx.calls).toHaveLength(1);
    expect((telnyx.calls[0]?.body as { text?: string }).text).toBe(
      EMERGENCY_ACK_BODY,
    );
  });

  it("still refuses to answer a contact who sent STOP", async () => {
    // Carrier truth outranks everything, including this. An emergency does not
    // license a message to someone who opted out.
    const conv = conversationStub();
    const claim = stubRoute(rpcMatch(env, "claim_emergency_ack"), () => ({}));
    const outcome = await send([conv, claim], "STOP");
    expect(outcome).toEqual({ sent: false, reason: "carrier_keyword" });
    expect(claim.calls).toHaveLength(0);
  });
});
