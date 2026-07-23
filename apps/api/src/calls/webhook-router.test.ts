/**
 * Calls v3 (#170 §7.2, #211) — the session-family webhook router. Pins the
 * routing decision that keeps the DO and the legacy path from ever splitting a
 * call: 4-part oc (part-4 = a valid UUID = S) → DO keyed on part-4 ONLY when the
 * outbound flag is live; 3-part oc, malformed part-4, brc/brt, and ANY 4-part oc
 * under a dark CALLS_OUTBOUND_V3 → legacy; the inbound family (brm/bri/vmi +
 * untagged incoming) → DO on Telnyx's id, flag-independent.
 */
import { describe, expect, it } from "vitest";

import { buildMemberRingState } from "../messaging/inbound-ring";
import {
  buildOutboundState,
  OUTBOUND_CUSTOMER_STATE,
} from "../messaging/voice-webhook";
import type { TelnyxEvent } from "../messaging/types";
import type { Env } from "../env";

import {
  isSessionFamilyCallEvent,
  sessionKeyFor,
  shouldRouteToDO,
} from "./webhook-router";

const S = "11111111-1111-4111-8111-111111111111";
const OC4 = buildOutboundState(OUTBOUND_CUSTOMER_STATE, "+15551234567", "nonce-1", S);
const OC3 = buildOutboundState(OUTBOUND_CUSTOMER_STATE, "+15551234567", "nonce-1");
const OC_BAD_PART4 = btoa("oc_customer|+15551234567|nonce-1|not-a-uuid");
const BRM = buildMemberRingState({
  sessionId: "sess-S",
  userId: "u1",
  caller: "+15551000",
  inboundCcid: "cust-ccid",
});

// #211: the outbound-oc 4-part routing requires the DO binding, no global kill,
// AND the CALLS_OUTBOUND_V3 flag. `outboundOn` satisfies all three; `outboundOff`
// leaves the DO path live (inbound still routes) but the outbound flag dark.
const outboundOn = {
  CALL_SESSIONS: { idFromName: () => ({}) },
  CALLS_V3_LEGACY: undefined,
  CALLS_OUTBOUND_V3: "1",
} as unknown as Env;
const outboundOff = {
  CALL_SESSIONS: { idFromName: () => ({}) },
  CALLS_V3_LEGACY: undefined,
  CALLS_OUTBOUND_V3: undefined,
} as unknown as Env;

function ev(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  return { data: { id: "x", event_type: eventType, payload } as never };
}

describe("isSessionFamilyCallEvent — #211 arity routing", () => {
  it("a 4-part oc leg is DO-owned for ALL THREE lifecycle events (flag ON)", () => {
    for (const type of ["call.initiated", "call.answered", "call.hangup"]) {
      expect(
        isSessionFamilyCallEvent(ev(type, { client_state: OC4, direction: "outgoing" }), outboundOn),
      ).toBe(true);
    }
  });

  it("SECURITY: a 4-part oc leg is NOT DO-owned when CALLS_OUTBOUND_V3 is dark", () => {
    // The call-hijack fix: with the outbound flag off, a crafted 4-part tag
    // carrying a victim's live session id must NOT route to idFromName(S_v). It
    // falls to legacy (which authorizes on the unforgeable nonce) instead.
    for (const type of ["call.initiated", "call.answered", "call.hangup"]) {
      expect(
        isSessionFamilyCallEvent(ev(type, { client_state: OC4, direction: "outgoing" }), outboundOff),
      ).toBe(false);
    }
  });

  it("a 3-part oc leg stays LEGACY (never split by arity)", () => {
    expect(
      isSessionFamilyCallEvent(ev("call.hangup", { client_state: OC3, direction: "outgoing" }), outboundOn),
    ).toBe(false);
    expect(
      isSessionFamilyCallEvent(ev("call.initiated", { client_state: OC3, direction: "outgoing" }), outboundOn),
    ).toBe(false);
  });

  it("a 4-part oc leg with a MALFORMED part-4 stays legacy (never idFromName'd)", () => {
    expect(
      isSessionFamilyCallEvent(ev("call.initiated", { client_state: OC_BAD_PART4, direction: "outgoing" }), outboundOn),
    ).toBe(false);
  });

  it("brm / bri / vmi remain DO-owned (flag-independent); the untagged inbound family too", () => {
    // The inbound family must NOT regress under a dark outbound flag; test both.
    for (const env of [outboundOn, outboundOff]) {
      expect(isSessionFamilyCallEvent(ev("call.answered", { client_state: BRM }), env)).toBe(true);
      expect(isSessionFamilyCallEvent(ev("call.hangup", { client_state: btoa("bri||2026-01-01T00:00:00Z") }), env)).toBe(true);
      expect(isSessionFamilyCallEvent(ev("call.hangup", { client_state: btoa("vmi|") }), env)).toBe(true);
      expect(isSessionFamilyCallEvent(ev("call.initiated", { direction: "incoming" }), env)).toBe(true);
      expect(isSessionFamilyCallEvent(ev("call.hangup", { direction: "incoming" }), env)).toBe(true);
    }
  });

  it("an untagged OUTGOING leg (a non-oc dial) is NOT session-family", () => {
    expect(isSessionFamilyCallEvent(ev("call.hangup", { direction: "outgoing" }), outboundOn)).toBe(false);
    expect(isSessionFamilyCallEvent(ev("call.initiated", { direction: "outgoing" }), outboundOn)).toBe(false);
  });
});

describe("sessionKeyFor — the ONE id every keying site resolves to", () => {
  it("a 4-part oc leg keys on tag part-4 (S), NEVER Telnyx's call_session_id (flag ON)", () => {
    const key = sessionKeyFor(ev("call.hangup", { client_state: OC4, call_session_id: "telnyx-T-9999" }), outboundOn);
    expect(key).toBe(S);
    expect(key).not.toBe("telnyx-T-9999");
  });

  it("SECURITY: with the outbound flag dark, a 4-part oc leg does NOT key on part-4", () => {
    // Defense in depth for the call-hijack fix: a caller-supplied part-4 can
    // never become an idFromName under a dark flag; it falls back to Telnyx's
    // own (unforgeable, per-leg) call_session_id.
    const key = sessionKeyFor(ev("call.hangup", { client_state: OC4, call_session_id: "telnyx-T-9999" }), outboundOff);
    expect(key).toBe("telnyx-T-9999");
    expect(key).not.toBe(S);
  });

  it("a brm leg keys on the tag's embedded session; untagged on call_session_id", () => {
    expect(sessionKeyFor(ev("call.answered", { client_state: BRM }), outboundOn)).toBe("sess-S");
    expect(sessionKeyFor(ev("call.hangup", { call_session_id: "sess-inbound" }), outboundOn)).toBe("sess-inbound");
  });
});

describe("shouldRouteToDO — gated on callsV3Active AND (for 4-part oc) the outbound flag", () => {
  const killed = {
    CALL_SESSIONS: { idFromName: () => ({}) },
    CALLS_V3_LEGACY: "1",
    CALLS_OUTBOUND_V3: "1",
  } as unknown as Env;

  it("routes a 4-part oc leg to the DO when v3 + the outbound flag are active", () => {
    expect(shouldRouteToDO(outboundOn, ev("call.initiated", { client_state: OC4, direction: "outgoing" }))).toBe(true);
  });

  it("SECURITY: a 4-part oc leg does NOT route to the DO when CALLS_OUTBOUND_V3 is dark", () => {
    expect(shouldRouteToDO(outboundOff, ev("call.initiated", { client_state: OC4, direction: "outgoing" }))).toBe(false);
  });

  it("a global kill sends EVERYTHING (incl. 4-part oc) to legacy", () => {
    expect(shouldRouteToDO(killed, ev("call.initiated", { client_state: OC4, direction: "outgoing" }))).toBe(false);
  });

  it("the inbound family still routes to the DO with the outbound flag dark", () => {
    expect(shouldRouteToDO(outboundOff, ev("call.initiated", { direction: "incoming" }))).toBe(true);
    expect(shouldRouteToDO(outboundOff, ev("call.answered", { client_state: BRM }))).toBe(true);
  });
});
