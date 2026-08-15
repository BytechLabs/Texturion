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
  DEFAULT_EMERGENCY_MESSAGE,
  EMERGENCY_KEYWORDS,
  EMERGENCY_SAFETY_LINE,
  awayEmergencyNotice,
  effectiveEmergencyKeywords,
  effectiveEmergencyMessage,
  emergencyKeywordError,
  emergencyWordList,
  emergencyReplyBody,
  isEmergencyKeyword,
  mentionsEmergencyKeyword,
  unrecognizedReplyKeyword,
} from "./emergency";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — this module says its copy through the reader's resolver now, so the
 * tests supply one. English by default: these cases are about WHICH sentence
 * is chosen, and a French assertion would be testing the translation rather
 * than the rule. The French is asserted in its own case at the bottom.
 */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


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
      say: sayEn,
        emergencyEnabled: true,
        awayMessage: SHIPPED_DEFAULT,
      }),
    ).toBeNull();
  });

  it("warns when the switch is off but the copy still promises", () => {
    const notice = awayEmergencyNotice({
      say: sayEn,
      emergencyEnabled: false,
      awayMessage: SHIPPED_DEFAULT,
    });
    expect(notice?.tone).toBe("warn");
  });

  it("names the unrecognised word — the #453 case", () => {
    const notice = awayEmergencyNotice({
      say: sayEn,
      emergencyEnabled: true,
      awayMessage: "For a burst pipe, reply ASAP and we'll ring you back.",
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("ASAP");
  });

  it("warns about the switch FIRST when both are wrong", () => {
    // No rewording fixes an off switch, so that is what to say.
    const notice = awayEmergencyNotice({
      say: sayEn,
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
      say: sayEn,
      emergencyEnabled: true,
      awayMessage: "Thanks for texting. We're closed and will reply Monday.",
    });
    expect(notice?.tone).toBe("hint");
  });

  it("stays silent when the switch is off and nothing was promised", () => {
    expect(
      awayEmergencyNotice({
      say: sayEn,
        emergencyEnabled: false,
        awayMessage: "Thanks for texting. We're closed and will reply Monday.",
      }),
    ).toBeNull();
  });

  it("does not warn about required STOP copy", () => {
    expect(
      awayEmergencyNotice({
      say: sayEn,
        emergencyEnabled: true,
        awayMessage: `${SHIPPED_DEFAULT} Reply STOP to unsubscribe.`,
      }),
    ).toBeNull();
  });
});

describe("#460 — the workspace's own words", () => {
  it("falls back to the product list, and null does not mean silence", () => {
    // The trap this contract avoids: a column that stored the defaults would
    // freeze whatever the list was the day each workspace signed up, so
    // improving it later would reach nobody.
    expect(effectiveEmergencyKeywords(null)).toEqual(EMERGENCY_KEYWORDS);
    expect(effectiveEmergencyKeywords(undefined)).toEqual(EMERGENCY_KEYWORDS);
    expect(effectiveEmergencyKeywords([])).toEqual(EMERGENCY_KEYWORDS);
  });

  it("normalises what an owner typed rather than refusing it", () => {
    expect(effectiveEmergencyKeywords([" lockedout ", "ASAP"])).toEqual([
      "LOCKEDOUT",
      "ASAP",
    ]);
    // A word that could never match is dropped rather than stored: the matcher
    // splits on whitespace, so "no heat" has no first token equal to itself.
    expect(effectiveEmergencyKeywords(["no heat", "SOS"])).toEqual(["SOS"]);
    expect(effectiveEmergencyKeywords(["SOS", "sos"])).toEqual(["SOS"]);
  });

  it("hears the locksmith's word and stops hearing ours", () => {
    // The whole point of the issue: a workspace that chose its own words is
    // listening for those, not for a plumber's.
    const own = effectiveEmergencyKeywords(["LOCKEDOUT"]);
    expect(isEmergencyKeyword("LOCKEDOUT front door won't open", own)).toBe(true);
    expect(isEmergencyKeyword("URGENT no heat", own)).toBe(false);
    // And the default list still behaves exactly as #414 pinned it.
    expect(isEmergencyKeyword("URGENT no heat")).toBe(true);
  });

  it("stops warning about a word the owner has just added — #453 crossover", () => {
    const copy = "We're closed. Reply ASAP if it can't wait.";
    // Before they add it: named, so they can act on it.
    expect(unrecognizedReplyKeyword(copy)).toBe("ASAP");
    expect(
      awayEmergencyNotice({
        say: sayEn,
        emergencyEnabled: true,
        awayMessage: copy,
      }),
    ).toMatchObject({ tone: "warn" });
    // After: silence. A warning that survives the fix teaches owners to ignore
    // warnings, which is worse than never having shown one.
    const own = effectiveEmergencyKeywords(["ASAP"]);
    expect(unrecognizedReplyKeyword(copy, own)).toBeNull();
    expect(
      awayEmergencyNotice({
      say: sayEn,
        emergencyEnabled: true,
        awayMessage: copy,
        keywords: own,
      }),
    ).toBeNull();
  });

  it("refuses a keyword the carrier answers, and says why", () => {
    // STOP reaches Telnyx before it reaches us, so storing it would be storing
    // a setting that provably cannot fire.
    expect(emergencyKeywordError("STOP", sayEn)).toMatch(/carrier/i);
    expect(emergencyKeywordError("no heat", sayEn)).toMatch(/one word/i);
    expect(emergencyKeywordError("SOS!", sayEn)).toMatch(/letters and numbers/i);
    expect(emergencyKeywordError("X", sayEn)).toMatch(/too short/i);
    expect(emergencyKeywordError("", sayEn)).toMatch(/type a word/i);
    expect(emergencyKeywordError("lockedout", sayEn)).toBeNull();
  });

  it("names the workspace's own words when it warns", () => {
    const notice = awayEmergencyNotice({
      say: sayEn,
      emergencyEnabled: true,
      awayMessage: "Reply NOW if it's an emergency.",
      keywords: effectiveEmergencyKeywords(["LOCKEDOUT"]),
    });
    // Telling an owner who uses LOCKEDOUT to "use URGENT instead" would be the
    // product arguing with a setting it offers.
    expect(notice?.text).toContain("LOCKEDOUT");
    expect(notice?.text).not.toContain("URGENT");
  });
});

describe("#460 — the reply body, and the sentence that is not the owner's", () => {
  it("appends the safety line to whatever the owner wrote", () => {
    expect(emergencyReplyBody("On our way when we can.")).toBe(
      `On our way when we can. ${EMERGENCY_SAFETY_LINE}`,
    );
  });

  it("falls back to the product default when blank", () => {
    for (const blank of [null, undefined, "", "   "]) {
      expect(emergencyReplyBody(blank)).toContain(DEFAULT_EMERGENCY_MESSAGE);
      expect(emergencyReplyBody(blank)).toContain(EMERGENCY_SAFETY_LINE);
    }
  });

  it("names no trade in the default, which is the founder's complaint", () => {
    for (const trade of [/gas/i, /utility/i, /burst/i, /no-heat/i, /pipe/i]) {
      expect(DEFAULT_EMERGENCY_MESSAGE).not.toMatch(trade);
      expect(EMERGENCY_SAFETY_LINE).not.toMatch(trade);
    }
  });

  it("reports custom vs default so a screen can say which is in effect", () => {
    expect(effectiveEmergencyMessage("mine")).toEqual({
      message: "mine",
      custom: true,
    });
    expect(effectiveEmergencyMessage("  ")).toEqual({
      message: DEFAULT_EMERGENCY_MESSAGE,
      custom: false,
    });
  });
});

describe("#228 the emergency screen in French", () => {
  it("refuses a keyword in the reader's language", () => {
    // The carrier sentence is the one worth pinning: it is the only refusal
    // that names the word back, and it names it TWICE in English. A port that
    // replaced the first occurrence only would read "STOP is answered by the
    // phone carrier … so {word} can't be an emergency word" — still a
    // sentence, still shipped, and wrong in the half nobody reads twice.
    for (const say of [sayEn, sayFr]) {
      const carrier = emergencyKeywordError("STOP", say);
      expect(carrier).toBeTruthy();
      expect(carrier).toContain("STOP");
      expect(carrier, "a variable survived the fill").not.toMatch(/\{word\}/);
    }
    expect(emergencyKeywordError("STOP", sayFr)).not.toBe(
      emergencyKeywordError("STOP", sayEn),
    );
  });

  it("names the unrecognised word and the list, in French, with no leftovers", () => {
    const notice = awayEmergencyNotice({
      say: sayFr,
      emergencyEnabled: true,
      awayMessage: "Pour une urgence, répondez ASAP et nous vous appellerons.",
      keywords: ["URGENT", "SOS"],
    });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("ASAP");
    // Both occurrences of {word}, and the {words} list with a French "ou".
    expect(notice?.text, "a variable survived the fill").not.toMatch(/\{word/);
    expect(notice?.text).toContain("URGENT");
    expect(notice?.text).toContain("SOS");
  });

  it("joins the word list with the reader's conjunction", () => {
    expect(emergencyWordList(["URGENT", "SOS"], sayEn)).toBe("URGENT or SOS");
    expect(emergencyWordList(["URGENT", "SOS"], sayFr)).toBe("URGENT ou SOS");
    // One word is one word in both languages — no conjunction to get wrong.
    expect(emergencyWordList(["URGENT"], sayFr)).toBe("URGENT");
    expect(emergencyWordList([], sayFr)).not.toBe(emergencyWordList([], sayEn));
  });
});
