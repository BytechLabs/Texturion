/**
 * Calls v3 (#170 §7.2, #211) — the session-family webhook router. v3 is the sole
 * path; there is no flag. Pins the routing decision that makes the DO the one
 * owner of every inbound and outbound CALL: a 4-part oc leg (part-4 = a valid
 * UUID = S) routes to the DO keyed on part-4; brm/bri/vmi + untagged incoming
 * route to the DO on Telnyx's id; brc/brt and a malformed/absent part-4 stay on
 * the shared voice path.
 *
 * SECURITY: with routing unconditional, a crafted 4-part tag carrying a VICTIM's
 * live session id S_v DOES route to idFromName(S_v) — that is expected and safe.
 * The hijack is closed downstream at loadOutboundInitiatedContext (nonce consume
 * + auth-scoped RPC replay + set-once stamp + one-id gate), pinned in
 * runtime.outbound.test.ts. This suite only asserts the routing itself.
 */
import { describe, expect, it } from "vitest";

import { buildMemberRingState } from "../messaging/inbound-ring";
import {
  buildOutboundState,
  OUTBOUND_CUSTOMER_STATE,
} from "../messaging/voice-webhook";
import type { TelnyxEvent } from "../messaging/types";

import {
  isSessionFamilyCallEvent,
  sessionKeyFor,
  shouldRouteToDO,
} from "./webhook-router";

const S = "11111111-1111-4111-8111-111111111111";
const OC4 = buildOutboundState(OUTBOUND_CUSTOMER_STATE, "+15551234567", "nonce-1", S);
// A tag with only three parts (no part-4) — nothing mints these anymore, but a
// stray one must never be treated as an oc DO session.
const OC3 = btoa("oc_customer|+15551234567|nonce-1");
const OC_BAD_PART4 = btoa("oc_customer|+15551234567|nonce-1|not-a-uuid");
const BRM = buildMemberRingState({
  sessionId: "sess-S",
  userId: "u1",
  caller: "+15551000",
  inboundCcid: "cust-ccid",
});

function ev(eventType: string, payload: Record<string, unknown>): TelnyxEvent {
  return { data: { id: "x", event_type: eventType, payload } as never };
}

describe("isSessionFamilyCallEvent — #211 arity routing (unconditional)", () => {
  it("a 4-part oc leg is DO-owned for ALL THREE lifecycle events", () => {
    for (const type of ["call.initiated", "call.answered", "call.hangup"]) {
      expect(
        isSessionFamilyCallEvent(ev(type, { client_state: OC4, direction: "outgoing" })),
      ).toBe(true);
    }
  });

  it("SECURITY: a crafted 4-part tag (victim's S_v) DOES route to the DO — the hijack is closed downstream, not by routing", () => {
    // With no flag, a forged 4-part tag carrying a victim's live session id
    // routes to idFromName(S_v). This is EXPECTED: loadOutboundInitiatedContext
    // (runtime.outbound.test.ts) drops/rejects it with no mint and no stamp, so
    // the victim's machine is never touched. The router does not gate it.
    const forged = buildOutboundState(OUTBOUND_CUSTOMER_STATE, "+15551234567", "random-nonce", S);
    for (const type of ["call.initiated", "call.answered", "call.hangup"]) {
      expect(
        isSessionFamilyCallEvent(ev(type, { client_state: forged, direction: "outgoing" })),
      ).toBe(true);
    }
  });

  it("a 3-part-shaped oc tag (no part-4) is NOT session-family", () => {
    expect(
      isSessionFamilyCallEvent(ev("call.hangup", { client_state: OC3, direction: "outgoing" })),
    ).toBe(false);
    expect(
      isSessionFamilyCallEvent(ev("call.initiated", { client_state: OC3, direction: "outgoing" })),
    ).toBe(false);
  });

  it("a 4-part oc leg with a MALFORMED part-4 stays off the DO (never idFromName'd)", () => {
    expect(
      isSessionFamilyCallEvent(ev("call.initiated", { client_state: OC_BAD_PART4, direction: "outgoing" })),
    ).toBe(false);
  });

  it("brm / bri / vmi are DO-owned; the untagged inbound family too", () => {
    expect(isSessionFamilyCallEvent(ev("call.answered", { client_state: BRM }))).toBe(true);
    expect(isSessionFamilyCallEvent(ev("call.hangup", { client_state: btoa("bri||2026-01-01T00:00:00Z") }))).toBe(true);
    expect(isSessionFamilyCallEvent(ev("call.hangup", { client_state: btoa("vmi|") }))).toBe(true);
    expect(isSessionFamilyCallEvent(ev("call.initiated", { direction: "incoming" }))).toBe(true);
    expect(isSessionFamilyCallEvent(ev("call.hangup", { direction: "incoming" }))).toBe(true);
  });

  it("an untagged OUTGOING leg (a non-oc dial) is NOT session-family", () => {
    expect(isSessionFamilyCallEvent(ev("call.hangup", { direction: "outgoing" }))).toBe(false);
    expect(isSessionFamilyCallEvent(ev("call.initiated", { direction: "outgoing" }))).toBe(false);
  });
});

describe("sessionKeyFor — the ONE id every keying site resolves to", () => {
  it("a 4-part oc leg keys on tag part-4 (S), NEVER Telnyx's call_session_id", () => {
    const key = sessionKeyFor(ev("call.hangup", { client_state: OC4, call_session_id: "telnyx-T-9999" }));
    expect(key).toBe(S);
    expect(key).not.toBe("telnyx-T-9999");
  });

  it("a brm leg keys on the tag's embedded session; untagged on call_session_id", () => {
    expect(sessionKeyFor(ev("call.answered", { client_state: BRM }))).toBe("sess-S");
    expect(sessionKeyFor(ev("call.hangup", { call_session_id: "sess-inbound" }))).toBe("sess-inbound");
  });
});

describe("shouldRouteToDO — exactly the session-family predicate", () => {
  it("routes a 4-part oc leg to the DO", () => {
    expect(shouldRouteToDO(ev("call.initiated", { client_state: OC4, direction: "outgoing" }))).toBe(true);
  });

  it("routes the inbound family to the DO", () => {
    expect(shouldRouteToDO(ev("call.initiated", { direction: "incoming" }))).toBe(true);
    expect(shouldRouteToDO(ev("call.answered", { client_state: BRM }))).toBe(true);
  });

  it("does NOT route brc/brt or a non-oc outgoing leg (they run the shared voice path)", () => {
    expect(shouldRouteToDO(ev("call.hangup", { client_state: btoa("brc|sess|u1|s"), direction: "outgoing" }))).toBe(false);
    expect(shouldRouteToDO(ev("call.hangup", { direction: "outgoing" }))).toBe(false);
  });
});
