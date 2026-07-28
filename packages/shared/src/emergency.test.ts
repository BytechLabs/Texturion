/**
 * #414 — two different questions, deliberately answered by two different rules.
 *
 * `isEmergencyKeyword` reads what a CUSTOMER sent and must not over-fire.
 * `mentionsEmergencyKeyword` reads what an OWNER wrote and must not under-fire.
 * Using one rule for both would either wake a crew for "nothing urgent" or
 * tell an owner their away message is fine while it promises a callback
 * nothing will make.
 */
import { describe, expect, it } from "vitest";

import {
  awayEmergencyNotice,
  isEmergencyKeyword,
  mentionsEmergencyKeyword,
  unrecognizedReplyKeyword,
} from "./emergency";

describe("what a frightened person actually types", () => {
  it.each([
    "URGENT",
    "urgent",
    "URGENT!!!",
    "URGENT - no heat",
    "Urgent, house is freezing and the kids are here",
    "EMERGENCY",
    "911",
    "SOS",
  ])("treats %j as an emergency", (body) => {
    expect(isEmergencyKeyword(body)).toBe(true);
  });

  it.each([
    "it's not urgent",
    "no rush, nothing urgent",
    "this is not an emergency but the tap drips",
    "can you come Tuesday",
    "",
  ])("does not fire on %j", (body) => {
    expect(isEmergencyKeyword(body)).toBe(false);
  });
});

describe("whether the owner's own copy still invites the reply", () => {
  it("finds the instruction anywhere in the message, not just at the start", () => {
    // The customer's reply LEADS with the word; the owner's message mentions
    // it mid-sentence. Anchoring this one to the first word would find the
    // invitation in no real away message ever written.
    expect(
      mentionsEmergencyKeyword(
        "Thanks for texting us. We're out of the office right now and will reply first thing. For a no-heat or burst-pipe emergency, reply URGENT and we'll call you.",
      ),
    ).toBe(true);
  });

  it.each(["reply EMERGENCY", "text 911 if it can't wait", "send SOS"])(
    "recognises %j as an invitation too",
    (copy) => {
      expect(mentionsEmergencyKeyword(copy)).toBe(true);
    },
  );

  it("leaves a message that promises nothing alone", () => {
    expect(
      mentionsEmergencyKeyword(
        "Thanks for texting. We're closed and will reply Monday morning.",
      ),
    ).toBe(false);
  });

  it("does not count a word that merely contains a keyword", () => {
    // "we respond urgently" is a tone, not an instruction to reply URGENT.
    expect(mentionsEmergencyKeyword("we respond urgently to every text")).toBe(
      false,
    );
    expect(mentionsEmergencyKeyword("emergency-only pricing applies")).toBe(
      true,
    );
  });
});

describe("#453 — the word the owner chose that nothing listens for", () => {
  it("names the unrecognised word so the surface can quote it back", () => {
    // The exact scenario #453 is about: a plumber's own vocabulary.
    expect(
      unrecognizedReplyKeyword(
        "We're closed right now. For a burst pipe, reply ASAP and we'll ring you straight back.",
      ),
    ).toBe("ASAP");
  });

  it.each(["reply ASAP", "text NOW", "respond HELPME", "send RESCUE"])(
    "flags %j",
    (copy) => {
      expect(unrecognizedReplyKeyword(copy)).not.toBeNull();
    },
  );

  it.each([
    "reply URGENT and we'll call you",
    "text EMERGENCY if it can't wait",
    "send SOS",
    "text 911 if it can't wait",
  ])("stays quiet on %j, which we DO handle", (copy) => {
    expect(unrecognizedReplyKeyword(copy)).toBeNull();
  });

  it.each([
    "Reply STOP to unsubscribe",
    "reply STOP to opt out, HELP for info",
    "reply YES to confirm your appointment",
  ])("never flags the carrier keyword in %j", (copy) => {
    // Warning that STOP is unrecognised is both wrong and the fastest way to
    // teach an owner to ignore this warning.
    expect(unrecognizedReplyKeyword(copy)).toBeNull();
  });

  it.each([
    "Thanks for texting. We're closed and will reply Monday morning.",
    "We reply to every message within 24 hours.",
    "Text us any time and we'll get back to you.",
    "",
  ])("does not invent a keyword in %j", (copy) => {
    expect(unrecognizedReplyKeyword(copy)).toBeNull();
  });

  it("reports the FIRST unrecognised word, not a later recognised one", () => {
    // An owner who offers two words gets told about the broken one, even
    // though the message also contains a keyword that works.
    expect(
      unrecognizedReplyKeyword("reply ASAP for emergencies, or reply URGENT"),
    ).toBe("ASAP");
  });

  it("agrees with mentionsEmergencyKeyword on the shipped default", () => {
    // The default away message must trip neither warning — it is the copy the
    // product itself wrote, and an owner who changes nothing must see nothing.
    const shipped =
      "Thanks for texting us. We're out of the office right now and will reply first thing. For a no-heat or burst-pipe emergency, reply URGENT and we'll call you.";
    expect(mentionsEmergencyKeyword(shipped)).toBe(true);
    expect(unrecognizedReplyKeyword(shipped)).toBeNull();
  });
});

describe("#453 — what the away-reply screen says, identically on all clients", () => {
  const SHIPPED_DEFAULT =
    "Thanks for texting us. We're out of the office right now and will reply first thing. For a no-heat or burst-pipe emergency, reply URGENT and we'll call you.";

  it("says nothing when the default message and the switch agree", () => {
    // The state most owners are in. A screen that nags here trains them to
    // ignore the one warning that matters.
    expect(
      awayEmergencyNotice({
        emergencyEnabled: true,
        awayMessage: SHIPPED_DEFAULT,
      }),
    ).toBeNull();
  });

  it("warns when the switch is off but the copy still promises", () => {
    const notice = awayEmergencyNotice({
      emergencyEnabled: false,
      awayMessage: SHIPPED_DEFAULT,
    });
    expect(notice?.tone).toBe("warn");
  });

  it("names the unrecognised word — the #453 case", () => {
    const notice = awayEmergencyNotice({
      emergencyEnabled: true,
      awayMessage: "For a burst pipe, reply ASAP and we'll ring you back.",
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("ASAP");
  });

  it("warns about the switch FIRST when both are wrong", () => {
    // No rewording fixes an off switch, so that is what to say.
    const notice = awayEmergencyNotice({
      emergencyEnabled: false,
      awayMessage: "For a burst pipe, reply ASAP and we'll ring you back.",
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).not.toContain("ASAP");
  });

  it("is a quiet hint, not a warning, when nothing invites it", () => {
    // An owner may simply not offer emergency service. That is what the
    // switch is for, and it is not an error.
    const notice = awayEmergencyNotice({
      emergencyEnabled: true,
      awayMessage: "Thanks for texting. We're closed and will reply Monday.",
    });
    expect(notice?.tone).toBe("hint");
  });

  it("stays silent when the switch is off and nothing was promised", () => {
    expect(
      awayEmergencyNotice({
        emergencyEnabled: false,
        awayMessage: "Thanks for texting. We're closed and will reply Monday.",
      }),
    ).toBeNull();
  });

  it("does not warn about required STOP copy", () => {
    expect(
      awayEmergencyNotice({
        emergencyEnabled: true,
        awayMessage: `${SHIPPED_DEFAULT} Reply STOP to unsubscribe.`,
      }),
    ).toBeNull();
  });
});
