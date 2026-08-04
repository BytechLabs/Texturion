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

import { CARRIER_REPLY_KEYWORDS } from "@loonext/shared";

import {
  HELP_KEYWORDS,
  START_KEYWORDS,
  STOP_KEYWORDS,
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

describe("#228 — a French opt-out is honoured, and nothing behind us catches it", () => {
  it("treats ARRET as an opt-out, in both spellings", () => {
    // The word a French-speaking customer in Canada actually sends. Telnyx's
    // opt-out set is English-only (verified against the live messaging profile
    // on 2026-08-04: smart_encoding off, no autoresp configs), so before this
    // an inbound ARRET arrived as an ordinary message - no opt_outs row, no
    // timeline event, and the auto-reply not suppressed.
    for (const body of ["ARRET", "ARRÊT", "arret", "  Arrêt  "]) {
      expect(STOP_KEYWORDS.has(body.trim().toUpperCase()), body).toBe(true);
    }
  });

  it("suppresses the auto-reply, so we never text back over an opt-out", () => {
    // The failure this prevents is specific and bad: somebody asks in French to
    // be left alone and receives an automated message in reply.
    for (const body of ["ARRET", "ARRÊT"]) {
      expect(isCarrierKeyword(body), body).toBe(true);
      expect(suppressesAutoReply(body), body).toBe(true);
    }
  });

  it("does not swallow a sentence that merely contains the word", () => {
    // Matching is exact on the trimmed body everywhere this set is used. A
    // customer writing about an "arret de bus" is not withdrawing consent, and
    // silencing them would be the expensive direction of this change.
    expect(STOP_KEYWORDS.has("ARRET DE BUS")).toBe(false);
    expect(suppressesAutoReply("on se voit a l'arret de bus")).toBe(false);
  });

  it("leaves AIDE out of the help set on purpose", () => {
    // Adding it would look like the matching fix and would be worse. This set
    // means "the carrier is answering, so we must not", and Telnyx answers AIDE
    // no more than it answers ARRET - so a French speaker asking for help would
    // get silence instead of the away message they get today. The fix is a
    // French help reply, which is #228's copy work.
    expect(HELP_KEYWORDS.has("AIDE")).toBe(false);
    expect(suppressesAutoReply("AIDE")).toBe(false);
  });
});

describe("#453 — the settings warning and the opt-out path agree on carrier words", () => {
  it("has the same carrier vocabulary on both sides", () => {
    // THIS FILE is canonical for the opt-out path: carrier truth is not moved
    // around casually. `shared` keeps its own copy so the settings screen can
    // decide whether an owner's "reply X" names something already handled.
    //
    // Two lists is the arrangement that caused #414, so this test is the thing
    // that makes it safe: add a keyword on either side alone and the build
    // fails here rather than in a settings screen telling an owner that STOP
    // is unrecognised.
    const canonical = [
      ...STOP_KEYWORDS,
      ...START_KEYWORDS,
      ...HELP_KEYWORDS,
    ].sort();
    expect([...CARRIER_REPLY_KEYWORDS].sort()).toEqual(canonical);
  });
});
