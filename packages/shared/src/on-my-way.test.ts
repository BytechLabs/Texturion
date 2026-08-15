import { describe, expect, it } from "vitest";

import {
  ON_MY_WAY_COPY,
  ON_MY_WAY_PRESETS,
  onMyWayPresetLabel,
  onMyWayText,
} from "./on-my-way";

import { copyFor, resolveLocale } from "./locale";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the copy assertions resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

describe("#520 the on-my-way text", () => {
  it("OMW-1: hedges the arrival, because a van cannot promise a minute", () => {
    // A tech who says 20 and arrives at 28 has not broken a promise. An exact
    // time - "arriving at 2:40" - is a claim about traffic nobody can make,
    // and the customer who writes it down is the one who is annoyed at 2:41.
    //
    // The separator is a HYPHEN and must stay one. An em dash is outside
    // GSM-7, and one character outside it drops the whole message to UCS-2 at
    // 67 units per segment instead of 153 - on a text sent once per visit.
    // `sms-copy-encoding.test.ts` enforces that across every automated body;
    // this pin is what stops the dash coming back as a typographic tidy-up.
    expect(onMyWayText(20)).toBe("On my way - about 20 minutes.");
    expect(onMyWayText(20)).toContain("about");
  });

  it("OMW-2: carries the number the tech chose, not a rounded one", () => {
    // The sentence is built from the preset, so a fifth choice added tomorrow
    // reads correctly without anybody touching this function.
    for (const minutes of ON_MY_WAY_PRESETS) {
      expect(onMyWayText(minutes)).toContain(String(minutes));
    }
  });

  it("OMW-3: offers few enough choices to pick one-handed", () => {
    // This is a control somebody uses with a toolbox in the other hand. Eight
    // options is a menu; four is a tap. And the gap between them is wider than
    // the accuracy the word "about" claims.
    expect(ON_MY_WAY_PRESETS.length).toBeLessThanOrEqual(4);
    expect([...ON_MY_WAY_PRESETS]).toEqual([...ON_MY_WAY_PRESETS].sort((a, b) => a - b));
  });

  it("OMW-4: labels a choice shorter than the sentence it sends", () => {
    // The chip says "20 min"; the customer reads the whole sentence. A chip
    // carrying the full text would not fit a phone, and one carrying a bare
    // "20" would not say twenty of what.
    expect(onMyWayPresetLabel(20)).toBe("20 min");
    expect(onMyWayPresetLabel(20).length).toBeLessThan(onMyWayText(20).length);
  });

  it("OMW-5: warns that the tap sends, before it is tapped", () => {
    // Somebody expecting a picker and getting a sent message has texted a
    // customer by accident. The prompt is a question, so the next tap reads as
    // answering it — and the note says what answering does.
    // Both languages: French puts a space before the question mark, so this
    // asks whether the mark is THERE rather than what precedes it.
    for (const table of [WEB_EN, WEB_FR]) {
      expect(look(table, ON_MY_WAY_COPY.prompt)).toContain("?");
    }
    expect(look(WEB_EN, ON_MY_WAY_COPY.gated_note)).toContain("Sends straight away");
    expect(look(WEB_FR, ON_MY_WAY_COPY.gated_note)).toMatch(/imm[ée]diatement/i);
  });

  it("OMW-6: says the gates still apply, so a refusal is not a broken button", () => {
    // An opt-out is binding however fast the send is meant to be (BINDING:
    // opt-out is carrier truth). A refusal arriving with no warning reads as
    // the feature being broken rather than as the rule working.
    expect(look(WEB_EN, ON_MY_WAY_COPY.gated_note)).toMatch(/same rules|any text/i);
    // The French has to carry the same promise, because the promise is what
    // stops a refusal reading as a broken button.
    expect(look(WEB_FR, ON_MY_WAY_COPY.gated_note)).toMatch(/m[êe]mes r[èe]gles/i);
  });

  it("OMW-7: is called what a crew calls it", () => {
    // Not "ETA" — that is a word for dispatchers. The whole affordance exists
    // for the person walking to the van.
    expect(look(WEB_EN, ON_MY_WAY_COPY.action)).toBe("On my way");
    // "En route", which is what a Quebec tech says. Not "Sur mon chemin",
    // which is the English idiom translated word for word, and not "ETA" —
    // that is a dispatcher's word in either language.
    expect(look(WEB_FR, ON_MY_WAY_COPY.action)).toBe("En route");
    for (const table of [WEB_EN, WEB_FR]) {
      expect(look(table, ON_MY_WAY_COPY.action).toLowerCase()).not.toContain("eta");
    }
  });
});

describe("#228 the body the CUSTOMER reads", () => {
  it("is French for a French-speaking contact", () => {
    // The gap this closes: every other automated body is picked on the send
    // path from the contact's row, and this one is composed in a thread view
    // and posted as an ordinary message — so nothing on the path ever asked
    // what language the customer reads. It does now.
    const fr = copyFor("fr-CA").onMyWay;
    expect(onMyWayText(20, fr)).toBe("En route - environ 20 minutes.");
    expect(onMyWayText(20, fr), "a variable survived").not.toMatch(/\{/);
  });

  it("falls back to English rather than to nothing", () => {
    // The default is deliberate here and nowhere else in this conversion. A
    // caller that has not been taught about the contact's language sends what
    // it always sent, rather than failing — this is the control somebody taps
    // one-handed walking to a van, and a translation gap must not become an
    // outage on it.
    expect(onMyWayText(20)).toBe("On my way - about 20 minutes.");
    expect(onMyWayText(20, copyFor("en").onMyWay)).toBe(onMyWayText(20));
  });

  it("resolves the contact over the company, and neither over nothing", () => {
    // The rung order resolveLocale exists for: this customer's own language
    // first, the workspace's next, English last.
    expect(copyFor(resolveLocale("fr-CA", "en")).onMyWay).toContain("En route");
    expect(copyFor(resolveLocale(null, "fr-CA")).onMyWay).toContain("En route");
    expect(copyFor(resolveLocale(null, null)).onMyWay).toContain("On my way");
    // An unrecognised locale on either rung falls back rather than throwing:
    // a row carrying a language some later migration added must not stop a
    // text reaching a customer.
    expect(copyFor(resolveLocale("de-DE", null)).onMyWay).toContain("On my way");
  });

  it("keeps the hedge in both languages", () => {
    // "About" is doing real work: a tech who says 20 and arrives at 28 has not
    // broken a promise. "environ" is that same word, and a French body that
    // dropped it would turn an estimate into a commitment.
    expect(onMyWayText(20, copyFor("en").onMyWay)).toContain("about");
    expect(onMyWayText(20, copyFor("fr-CA").onMyWay)).toContain("environ");
  });
});
