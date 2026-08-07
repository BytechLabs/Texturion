import {
  CONTACT_IMPORT_IGNORE,
  formatVCardProperty,
  vcardParameterProperty,
  VCARD_MAPPED_PROPERTIES,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import {
  answerProperty,
  ignoreRemainingProperties,
  propertyDeclarations,
  readVCardProperties,
  VCARD_SAMPLE_LIMIT,
} from "./vcard-properties";

/**
 * #248 round 3 — the vCard door, which had no gate of any kind.
 *
 * `CATEGORIES:DNC` and a `NOTE` reading "DO NOT CONTACT - asked us to stop" are
 * the only two places the format lets a card say do-not-text, they are what
 * Apple and Google actually export, and both were dropped by the importer
 * without a word while the file's consent attestation was written over the top.
 *
 * The fixture below is a MIX: three cards, one carrying a category, one
 * carrying a note, one carrying neither. A one-card fixture is how the CSV half
 * of this issue passed twice while broken.
 */
const BOOK = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ann Rivera",
  "TEL;TYPE=CELL:+12065550100",
  "CATEGORIES:DNC",
  "ORG:Rivera Roofing",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Bo Tran",
  "TEL;TYPE=CELL:+12065550101",
  "NOTE:DO NOT CONTACT - asked us to stop",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Cy Okafor",
  "TEL;TYPE=CELL:+12065550102",
  "ORG:Okafor Electric",
  "END:VCARD",
].join("\r\n");

describe("readVCardProperties: what the cards carry that we do not read", () => {
  it("VP-1: reports the two properties a .vcf can say do-not-text in", () => {
    const { cards, properties } = readVCardProperties(BOOK);

    expect(cards).toBe(3);
    // `TEL;TYPE` is in this list because a PARAMETER is free text of its own.
    // TEL is mapped, so its line used to be taken for the number and the rest
    // of it thrown away, which is where Apple writes `X-ABLabel=DO NOT CALL`.
    // The cost of having no vocabulary is that the ubiquitous `TYPE=CELL` gets
    // asked about too; that cost is accepted upstream, in the shared docblock.
    expect(properties.map((row) => row.property).sort()).toEqual([
      "CATEGORIES",
      "NOTE",
      "ORG",
      vcardParameterProperty("TEL", "TYPE"),
    ]);
  });

  it("VP-2: shows what each one SAYS, sentence and all", () => {
    // The values are the whole design. A person who cannot see "DNC" cannot
    // skip it knowingly, and then the click is theatre. Nothing truncates them
    // either: round two capped a decision at 16 characters, and this note is
    // 36 — "a decision is a token, not a sentence" is simply false.
    const { properties } = readVCardProperties(BOOK);
    const byName = new Map(properties.map((row) => [row.property, row]));

    expect(byName.get("CATEGORIES")?.samples).toEqual(["DNC"]);
    expect(byName.get("NOTE")?.samples).toEqual([
      "DO NOT CONTACT - asked us to stop",
    ]);
  });

  it("VP-3: never asks about a property the importer reads", () => {
    // Asserted against the SHARED list the server excludes by, not a list
    // retyped here: a property the importer starts reading tomorrow must stop
    // being asked about in the same commit, and a retyped copy would go on
    // asking.
    const asked = readVCardProperties(BOOK).properties.map(
      (row) => row.property,
    );

    for (const mapped of VCARD_MAPPED_PROPERTIES) {
      expect(asked).not.toContain(mapped);
    }
    // And the envelope itself is not a fact about a person.
    expect(asked).not.toContain("VERSION");
  });

  it("VP-4: pre-answers nothing at all", () => {
    // Unlike the CSV wizard, where a header spelled `Phone` is a guess worth
    // making on somebody's behalf, there is nothing to guess here: `NOTE` is
    // house-keeping on most cards and a revocation on the one that matters, and
    // this product may not pick either answer for a customer.
    const { properties } = readVCardProperties(BOOK);

    expect(properties.every((row) => row.answer === null)).toBe(true);
    expect(propertyDeclarations(properties)).toBeNull();
  });

  it("VP-5: counts the cards each property is actually on", () => {
    // "On 1 of 40 cards" is the difference between the file's furniture and
    // somebody having said something about one person.
    const byName = new Map(
      readVCardProperties(BOOK).properties.map((row) => [row.property, row]),
    );

    expect(byName.get("ORG")?.cards).toBe(2);
    expect(byName.get("CATEGORIES")?.cards).toBe(1);
    expect(byName.get("NOTE")?.cards).toBe(1);
    expect(byName.get(vcardParameterProperty("TEL", "TYPE"))?.cards).toBe(3);
    // RAREST FIRST. `CATEGORIES:DNC` is on one card of three and is the reason
    // this screen exists; `TEL;TYPE` is on all three and decides nothing. The
    // order used to be most-carried first, which was survivable while `ORG` led
    // it and became the file's furniture burying the one-off the moment
    // parameters were enumerated.
    const order = readVCardProperties(BOOK).properties.map(
      (row) => row.property,
    );
    expect(order[0]).toBe("CATEGORIES");
    expect(order[order.length - 1]).toBe(vcardParameterProperty("TEL", "TYPE"));
  });

  it("VP-6: reads a grouped, parameterised property under its bare name", () => {
    // Apple exports `item1.X-ABLabel:` and `item1.X-ABADR;TYPE=HOME:`. Reading
    // those as `ITEM1.X-ABLABEL` would declare a property name the server never
    // reports, so its own would go unanswered and every Apple export would be
    // refused with nothing the person could do about it.
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann",
        "TEL:+12065550100",
        "item1.X-ABLabel:do not text",
        "END:VCARD",
      ].join("\r\n"),
    );

    expect(properties.map((row) => row.property)).toEqual(["X-ABLABEL"]);
    expect(properties[0].samples).toEqual(["do not text"]);
  });

  it("VP-7: unfolds a wrapped line instead of reading it as a property", () => {
    // RFC folding breaks a long NOTE across lines with a leading space. Read
    // unfolded, the tail is part of the note; read raw, the note is truncated
    // exactly where the do-not-text part begins.
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann",
        "TEL:+12065550100",
        "NOTE:Roof done May 2026. Asked us",
        "  to stop texting her.",
        "END:VCARD",
      ].join("\r\n"),
    );

    expect(properties).toHaveLength(1);
    expect(properties[0].samples).toEqual([
      "Roof done May 2026. Asked us to stop texting her.",
    ]);
  });

  it("VP-8: reports distinct values and says when there are more", () => {
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "FN:A",
        "TEL:+12065550100",
        "X-STATUS:one",
        "END:VCARD",
        "BEGIN:VCARD",
        "FN:B",
        "TEL:+12065550101",
        "X-STATUS:two",
        "END:VCARD",
        "BEGIN:VCARD",
        "FN:C",
        "TEL:+12065550102",
        "X-STATUS:three",
        "END:VCARD",
        "BEGIN:VCARD",
        "FN:D",
        "TEL:+12065550103",
        "X-STATUS:DO NOT CALL",
        "END:VCARD",
      ].join("\r\n"),
    );

    expect(properties[0].samples).toHaveLength(VCARD_SAMPLE_LIMIT);
    expect(properties[0].more).toBe(true);
    expect(properties[0].cards).toBe(4);
  });

  it("VP-14: reads the LABEL on a TEL line, not the number beside it", () => {
    // The third door, and the one that looked closed. `item1.X-ABLabel:` — the
    // grouped form — was always caught; this is Apple's OTHER shape, inline on
    // the TEL line. TEL is mapped, so the line was read for its number and
    // everything after the first `;` was discarded, which is exactly where the
    // one sentence saying not to text this person was sitting.
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann",
        "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550100",
        "END:VCARD",
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Bo",
        "TEL;TYPE=HOME:+16135550101",
        "END:VCARD",
      ].join("\r\n"),
    );
    const byName = new Map(properties.map((row) => [row.property, row]));

    // The token the SERVER will demand, built by the shared function rather
    // than spelled here: a client that declares `TEL;X-ABLabel=DO NOT CALL` has
    // answered a question nobody asked, and the upload is refused with nothing
    // the person can do about it.
    const label = vcardParameterProperty("TEL", "X-ABLABEL");
    expect(byName.get(label)?.samples).toEqual(["DO NOT CALL"]);
    // The parameter's own text, never the line's value. A phone number is not
    // evidence about the label sitting beside it.
    expect(byName.get(label)?.samples).not.toContain("+16135550100");
    expect(byName.get(label)?.cards).toBe(1);
    // The mix: the ordinary card carries TYPE and no label, so the two
    // parameters on one line are counted apart.
    expect(byName.get(vcardParameterProperty("TEL", "TYPE"))?.samples).toEqual([
      "CELL",
      "HOME",
    ]);
    // And the one-off leads, not the parameter every card carries.
    expect(properties[0].property).toBe(label);
  });

  it("VP-15: enumerates a line with no colon at all", () => {
    // `DO-NOT-CALL` on its own is not a content line by the RFC, which is a
    // statement about the format rather than about what the file was trying to
    // say. The old parser returned null before the property was ever recorded,
    // so the card imported and the message was delivered.
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann",
        "TEL:+12065550100",
        "DO-NOT-CALL",
        "END:VCARD",
      ].join("\r\n"),
    );

    expect(properties.map((row) => row.property)).toEqual(["DO-NOT-CALL"]);
    // Nothing to show, only something to declare: the token IS the whole line.
    expect(properties[0].samples).toEqual([]);
    expect(properties[0].cards).toBe(1);
    expect(propertyDeclarations(properties)).toBeNull();
  });

  it("VP-16: enumerates a property whose parameter is malformed", () => {
    // `CATEGORIES;TYPE="a:DNC` — an unbalanced quote, so the only colon on the
    // line reads as quoted and there is no value. Same drop by a different
    // route, and the property is one of the two a .vcf can say stop in.
    const { properties } = readVCardProperties(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann",
        "TEL:+12065550100",
        'CATEGORIES;TYPE="a:DNC',
        "END:VCARD",
      ].join("\r\n"),
    );

    expect(properties.map((row) => row.property).sort()).toEqual([
      "CATEGORIES",
      vcardParameterProperty("CATEGORIES", "TYPE"),
    ]);
  });

  it("VP-9: tolerates a file with no VCARD blocks at all", () => {
    // The server refuses this file separately ("no VCARD blocks found"). This
    // one must not invent properties out of the loose lines on the way there.
    expect(readVCardProperties("FN:Ann\r\nTEL:+12065550100")).toEqual({
      cards: 0,
      properties: [],
    });
  });
});

describe("answering the properties", () => {
  it("VP-10: declares every property once the last one is answered", () => {
    let properties = readVCardProperties(BOOK).properties;
    for (const row of properties) {
      properties = answerProperty(
        properties,
        row.property,
        row.property === "CATEGORIES" ? "opted_out" : CONTACT_IMPORT_IGNORE,
      );
    }

    expect(propertyDeclarations(properties)?.map(formatVCardProperty)).toEqual([
      "CATEGORIES:opted_out",
      `NOTE:${CONTACT_IMPORT_IGNORE}`,
      `ORG:${CONTACT_IMPORT_IGNORE}`,
      `${vcardParameterProperty("TEL", "TYPE")}:${CONTACT_IMPORT_IGNORE}`,
    ]);
  });

  it("VP-11: one answer short is no declaration at all", () => {
    // Null rather than a partial list, because a partial list is exactly what
    // the server refuses — and a client that posts one is betting the refusal
    // will be read by somebody.
    const properties = answerProperty(
      readVCardProperties(BOOK).properties,
      "ORG",
      CONTACT_IMPORT_IGNORE,
    );

    expect(propertyDeclarations(properties)).toBeNull();
  });

  it("VP-12: the bulk dismissal never overwrites an answer somebody gave", () => {
    const answered = answerProperty(
      readVCardProperties(BOOK).properties,
      "CATEGORIES",
      "opted_out",
    );
    const rest = ignoreRemainingProperties(answered);

    expect(rest.find((row) => row.property === "CATEGORIES")?.answer).toBe(
      "opted_out",
    );
    expect(propertyDeclarations(rest)?.map(formatVCardProperty)).toContain(
      "CATEGORIES:opted_out",
    );
  });

  it("VP-13: an answer can be taken back", () => {
    // The row stays listed after it is answered. One that vanished would leave
    // no way to see what was asserted, or to change your mind.
    const answered = ignoreRemainingProperties(
      readVCardProperties(BOOK).properties,
    );
    const undone = answerProperty(answered, "NOTE", null);

    expect(propertyDeclarations(undone)).toBeNull();
  });
});
