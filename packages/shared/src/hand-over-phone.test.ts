import { describe, expect, it } from "vitest";

import {
  HAND_OVER_PHONE_ACTION,
  HAND_OVER_PHONE_CANCEL,
  HAND_OVER_PHONE_CONFIRM,
  handOverPhoneBody,
  handOverPhoneCosts,
} from "./hand-over-phone";

describe("what the handover says (#330)", () => {
  it("names what leaves the phone, rather than saying 'your data'", () => {
    // The person handing it over is deciding whether it is safe to. "Some data
    // will be removed" does not answer that; the list does.
    const body = handOverPhoneBody(0);
    expect(body).toContain("conversations");
    expect(body).toContain("customers");
    expect(body).toContain("signed out");
  });

  it("says the next person signs in as themselves", () => {
    // The whole point. Handing the phone over signed in as somebody else is the
    // behaviour this replaces, and it attributes every reply to the wrong person.
    expect(handOverPhoneBody(0)).toContain("signs in as themselves");
  });

  it("warns about unsent messages, and counts them", () => {
    // Ending the session clears the outbox, so a handover discards whatever is
    // still waiting for signal. A number is actionable in a way that "any unsent
    // messages" is not.
    expect(handOverPhoneBody(1)).toContain("One message");
    expect(handOverPhoneBody(1)).toContain("discarded");
    expect(handOverPhoneBody(3)).toContain("3 messages");
    expect(handOverPhoneBody(3)).toContain("discarded");
  });

  it("tells somebody what to do instead, not just what they will lose", () => {
    expect(handOverPhoneBody(2)).toContain("signal");
  });

  it("says nothing about unsent messages when there are none", () => {
    // The common case is a clean handover. A warning that fires every time is a
    // warning nobody reads on the day it matters.
    const body = handOverPhoneBody(0);
    expect(body).not.toContain("discarded");
    expect(body).not.toContain("signal");
  });

  it("is one sentence longer, not a different screen, when there is a cost", () => {
    // Same dialog either way: a second layout for the warning case would be a
    // second thing to keep true.
    expect(handOverPhoneBody(1).startsWith(handOverPhoneBody(0))).toBe(true);
  });
});

describe("handOverPhoneCosts (#330)", () => {
  it("is true only when something would actually be lost", () => {
    expect(handOverPhoneCosts(0)).toBe(false);
    expect(handOverPhoneCosts(1)).toBe(true);
    expect(handOverPhoneCosts(9)).toBe(true);
  });
});

describe("the labels (#330)", () => {
  it("names the intent rather than the mechanism", () => {
    // "Sign out" describes what the code does. "Hand this phone to someone else"
    // is the sentence already in the head of the person about to do it.
    expect(HAND_OVER_PHONE_ACTION.toLowerCase()).toContain("phone");
    expect(HAND_OVER_PHONE_ACTION.toLowerCase()).toContain("someone else");
  });

  it("makes both buttons say what they do", () => {
    // Not "OK"/"Cancel". Either of these is a reasonable choice on a job site, and
    // the wrong one costs either a customer's privacy or an unsent message.
    expect(HAND_OVER_PHONE_CONFIRM.toLowerCase()).toContain("sign out");
    expect(HAND_OVER_PHONE_CANCEL.toLowerCase()).toContain("stay signed in");
  });
});
