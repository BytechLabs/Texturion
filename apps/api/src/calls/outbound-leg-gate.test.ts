import { describe, expect, it } from "vitest";

import { isOwnDialedLeg, requiresUnauthorizedHangup } from "./outbound-leg-gate";

describe("isOwnDialedLeg", () => {
  it("accepts the credential URIs this server actually dials", () => {
    expect(isOwnDialedLeg("sip:member_abc123@sip.telnyx.com")).toBe(true);
    expect(isOwnDialedLeg("SIP:Member_ABC@SIP.TELNYX.COM")).toBe(true);
    expect(isOwnDialedLeg("  sip:user@sip.telnyx.com  ")).toBe(true);
  });

  it("rejects a phone number, which is never a leg we dialed", () => {
    expect(isOwnDialedLeg("+15551234567")).toBe(false);
    expect(isOwnDialedLeg("15551234567")).toBe(false);
  });

  it("rejects a PSTN destination wearing a SIP costume", () => {
    // The whole point of the gate: the tag is attacker-controlled, so the dial
    // target is the only thing worth trusting, and a numeric user part is a
    // phone number no matter what host it claims.
    expect(isOwnDialedLeg("sip:+15551234567@sip.telnyx.com")).toBe(false);
    expect(isOwnDialedLeg("sip:15551234567@sip.telnyx.com")).toBe(false);
  });

  it("rejects a credential-looking URI on someone else's host", () => {
    expect(isOwnDialedLeg("sip:user@evil.example.com")).toBe(false);
    // A substring check passed this one: the host merely CONTAINS ours.
    expect(isOwnDialedLeg("sip:user@sip.telnyx.com.evil.com")).toBe(false);
    expect(isOwnDialedLeg("sip:user@notsip.telnyx.com")).toBe(false);
  });

  it("tolerates the port and parameters Telnyx actually emits", () => {
    expect(isOwnDialedLeg("sip:member_abc@sip.telnyx.com:5060")).toBe(true);
    expect(isOwnDialedLeg("sip:member_abc@sip.telnyx.com;transport=tls")).toBe(
      true,
    );
  });

  it("rejects nothing at all", () => {
    expect(isOwnDialedLeg(null)).toBe(false);
    expect(isOwnDialedLeg(undefined)).toBe(false);
    expect(isOwnDialedLeg("")).toBe(false);
  });
});

describe("requiresUnauthorizedHangup", () => {
  it("demands a hangup for an outgoing leg to a phone number", () => {
    // This is the forgery: a member with a WebRTC token crafts a session-family
    // client_state and dials a PSTN number. Nothing authorized it, and dropping
    // it silently leaves a live billable channel with no call row and no cap.
    expect(
      requiresUnauthorizedHangup({ direction: "outgoing", to: "+15551234567" }),
    ).toBe(true);
    expect(
      requiresUnauthorizedHangup({
        direction: "outgoing",
        to: "sip:+15551234567@sip.telnyx.com",
      }),
    ).toBe(true);
  });

  it("leaves our own dialed legs alone", () => {
    expect(
      requiresUnauthorizedHangup({
        direction: "outgoing",
        to: "sip:member_abc@sip.telnyx.com",
      }),
    ).toBe(false);
  });

  it("never touches an inbound leg", () => {
    // An incoming call is a customer calling us, which is the product working.
    expect(
      requiresUnauthorizedHangup({ direction: "incoming", to: "+15551234567" }),
    ).toBe(false);
    expect(requiresUnauthorizedHangup({ to: "+15551234567" })).toBe(false);
  });
});
