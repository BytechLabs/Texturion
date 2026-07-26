/**
 * #414 — the emergency keyword the product told a homeowner to send.
 *
 * The default away message, shipped enabled and kept by most owners, ends
 * "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."
 * Nothing handled URGENT until now.
 *
 * The matching rule is the whole feature. Too strict and the promise stays
 * broken for anyone who types naturally under stress; too loose and we wake a
 * crew at 3am because somebody wrote "no rush, nothing urgent".
 */
import { describe, expect, it } from "vitest";

import {
  isCarrierKeyword,
  isEmergencyKeyword,
  suppressesAutoReply,
} from "./keywords";

describe("what a frightened person actually types (#414)", () => {
  it.each([
    "URGENT",
    "urgent",
    "Urgent",
    "URGENT!",
    "URGENT!!!",
    "URGENT - no heat",
    "Urgent, house is freezing and the kids are here",
    "URGENT: burst pipe in the basement",
    "EMERGENCY",
    "emergency water everywhere",
    "911",
    "SOS",
  ])("treats %j as an emergency", (body) => {
    expect(isEmergencyKeyword(body)).toBe(true);
  });

  it.each([
    "it's not urgent",
    "no rush, nothing urgent",
    "call me when it's less urgent",
    "this is not an emergency but the tap drips",
    "can you come Tuesday",
    "",
    "   ",
  ])("does not fire on %j", (body) => {
    expect(isEmergencyKeyword(body)).toBe(false);
  });

  it("anchors on the FIRST word, which is what the instruction asked for", () => {
    // The reply we asked for leads with the word. Matching anywhere in the
    // body would turn every "it's not urgent" into a 3am wake-up, and a crew
    // woken for nothing stops trusting the one that matters.
    expect(isEmergencyKeyword("URGENT the furnace is dead")).toBe(true);
    expect(isEmergencyKeyword("the furnace is dead, urgent")).toBe(false);
  });
});

describe("an emergency never draws the away reply (#414 ask 4)", () => {
  it("suppresses the auto-reply for an emergency", () => {
    // Otherwise someone who did exactly what we asked receives the same
    // instruction back — "reply URGENT and we'll call you" — in answer to
    // having replied URGENT.
    expect(suppressesAutoReply("URGENT no heat")).toBe(true);
  });

  it("still suppresses it for the carrier keywords", () => {
    for (const body of ["STOP", "HELP", "START"]) {
      expect(isCarrierKeyword(body)).toBe(true);
      expect(suppressesAutoReply(body)).toBe(true);
    }
  });

  it("leaves an ordinary message alone", () => {
    expect(suppressesAutoReply("do you do gutters?")).toBe(false);
  });
});
