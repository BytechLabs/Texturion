/**
 * #396 — the detector that warns a crew, and must never silence a lead.
 *
 * The asymmetry drives every case below. A MISSED opt-out leaves the thread
 * looking ordinary, which is the status quo and a TCPA exposure. A WRONG one
 * would put a banner on a live job — and if this ever fed the opt-out itself,
 * would permanently silence a paying customer's real customer, because only
 * they can lift it by texting START.
 *
 * So the false-positive cases are as load-bearing as the true ones, and the
 * trade vocabulary ("stop by the shop") is where the danger actually is.
 */
import { describe, expect, it } from "vitest";

import { looksLikeOptOut } from "./opt-out-language";

describe("what a person actually types to be left alone", () => {
  it.each([
    "please stop texting me",
    "Stop texting me.",
    "STOP TEXTING ME!!!",
    "stop messaging me please",
    "don't text me again",
    "dont text me again",
    "do not contact me again",
    "take me off your list",
    "Take me off the list please",
    "remove me off your mailing list",
    "unsubscribe me",
    "please unsubscribe me from these",
    "opt me out",
    "no more texts",
    "no more messages please",
    "leave me alone",
    "never text me again",
    "quit texting me",
    "wrong number",
    "delete my number",
    "I don't want any more texts",
  ])("flags %j", (body) => {
    expect(looksLikeOptOut(body)).toBe(true);
  });

  it("finds it inside a longer message", () => {
    // Real ones rarely arrive alone — they come attached to the reason.
    expect(
      looksLikeOptOut(
        "We went with someone else for the furnace, so please stop texting me. Thanks for the quote though.",
      ),
    ).toBe(true);
  });
});

describe("what must NOT fire, because a banner nobody believes is worse than none", () => {
  it.each([
    // The one that would embarrass us most: an invitation, read as a refusal.
    "stop by the shop tomorrow and we'll sort it",
    "can you stop in around 3",
    "I'll stop at the supply house on the way",
    "stop over whenever you're free",
    // Timing instructions, not withdrawal of consent.
    "don't text me until after 5",
    "please don't call me before 9am",
    "do not text me while I'm at work",
    // Talking ABOUT the keyword.
    "my other contractor said reply stop to get off their list",
    // Ordinary trade traffic.
    "can you come Tuesday",
    "the tap is still dripping",
    "sounds good, see you then",
    "no more leaks since you left, thanks",
    "",
  ])("stays quiet on %j", (body) => {
    expect(looksLikeOptOut(body)).toBe(false);
  });

  it.each(["stop", "unsubscribe", "cancel", "quit", "STOP", " stop "])(
    "leaves the bare carrier keyword %j alone",
    (body) => {
      // These are the CARRIER's job — Telnyx blocks them at the profile and
      // `stop_keyword` records them. This detector exists only for what that
      // path cannot see; raising a second, weaker signal about a message
      // already handled would just make the banner mean less.
      expect(looksLikeOptOut(body)).toBe(false);
    },
  );

  it("handles null and whitespace without throwing", () => {
    expect(looksLikeOptOut(null)).toBe(false);
    expect(looksLikeOptOut(undefined)).toBe(false);
    expect(looksLikeOptOut("   \n\t ")).toBe(false);
  });
});
