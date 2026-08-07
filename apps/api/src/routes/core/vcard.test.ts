/**
 * Hand-rolled vCard parser (D20 §3.2): vCard 3.0 + 4.0, multi-card files, line
 * folding, TEL params + tel: URIs, grouped properties, FN/N name extraction.
 */
import { describe, expect, it } from "vitest";

import { parseVCards, VCardMalformedError } from "./vcard";

describe("parseVCards", () => {
  it("parses a single vCard 3.0 card: FN + TEL", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Alice Adams",
      "TEL;TYPE=CELL:(416) 555-0111",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)).toEqual([
      {
        name: "Alice Adams",
        tels: ["(416) 555-0111"],
        // `TEL;TYPE` is here because a parameter is free text nobody read —
        // see the H3 tests below, where the same shape carries "DO NOT CALL".
        properties: ["VERSION", "FN", "TEL", "TEL;TYPE"],
      },
    ]);
  });

  it("parses multiple cards in one file", () => {
    const vcf = [
      "BEGIN:VCARD\nFN:A\nTEL:+14165550111\nEND:VCARD",
      "BEGIN:VCARD\nFN:B\nTEL:+15125550122\nEND:VCARD",
    ].join("\n");
    const cards = parseVCards(vcf);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe("A");
    expect(cards[1].tels).toEqual(["+15125550122"]);
  });

  it("handles a vCard 4.0 tel: URI value and TEL params", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Bob Baker",
      "TEL;VALUE=uri;TYPE=cell:tel:+15125550122",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].tels).toEqual(["+15125550122"]);
  });

  it("keeps multiple distinct TELs per card, de-duplicating exact repeats", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Multi",
      "TEL;TYPE=CELL:+14165550111",
      "TEL;TYPE=WORK:212-555-0133",
      "TEL:+14165550111", // exact repeat → dropped
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].tels).toEqual([
      "+14165550111",
      "212-555-0133",
    ]);
  });

  it("unfolds RFC-folded lines (continuation begins with a space/tab)", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Very Long",
      " Name Here",
      "TEL:+14165550111",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].name).toBe("Very LongName Here");
  });

  it("#248: unfolds a folded PROPERTY NAME, so the gate still sees it", () => {
    // The folding test above splits a VALUE, which the parser was always going
    // to read. A name split across the fold is the case that decides whether
    // the property is REPORTED at all: `NO` + ` TE:` reaches `parseContentLine`
    // as two lines unless unfolding runs first, and the route can only demand a
    // declaration for a property the parser told it about. An exporter that
    // wraps at 75 octets — which the RFC asks for — produces exactly this.
    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana",
      "TEL:+14165550111",
      "NO",
      " TE:DO NOT CONTACT - asked us to stop",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].properties).toContain("NOTE");
  });

  it("assembles a name from a structured N when FN is absent", () => {
    const vcf = [
      "BEGIN:VCARD",
      "N:Smith;Jo;;;",
      "TEL:+14165550111",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].name).toBe("Jo Smith");
  });

  it("prefers FN over N for the name", () => {
    const vcf = [
      "BEGIN:VCARD",
      "N:Smith;Jo;;;",
      "FN:Jo Smith Jr",
      "TEL:+14165550111",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].name).toBe("Jo Smith Jr");
  });

  it("strips a group prefix on properties (item1.TEL / GROUP.FN)", () => {
    const vcf = [
      "BEGIN:VCARD",
      "item1.FN:Grouped Name",
      "item1.TEL:+14165550111",
      "END:VCARD",
    ].join("\r\n");
    const card = parseVCards(vcf)[0];
    expect(card.name).toBe("Grouped Name");
    expect(card.tels).toEqual(["+14165550111"]);
  });

  it("reports a card with no TEL as tels: []", () => {
    const vcf = ["BEGIN:VCARD", "FN:No Phone", "END:VCARD"].join("\r\n");
    expect(parseVCards(vcf)).toEqual([
      { name: "No Phone", tels: [], properties: ["FN"] },
    ]);
  });

  it("#248: reports EVERY property, including the ones it does not read", () => {
    // The vCard door had no gate at all. `CATEGORIES:DNC` and a `NOTE` saying
    // they asked us to stop are the only two places the format lets a card say
    // do-not-text, they are what Apple and Google actually export, and both
    // were dropped here without a word while the file's attestation was written
    // over the top. The route cannot answer for what it was never told about.
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL:+14165550111",
      "CATEGORIES:DNC",
      "NOTE:DO NOT CONTACT - asked us to stop",
      "EMAIL:dana@example.com",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].properties).toEqual([
      "VERSION",
      "FN",
      "TEL",
      "CATEGORIES",
      "NOTE",
      "EMAIL",
    ]);
  });

  it("#248: reports a grouped property under its bare name, once", () => {
    // `item1.X-ABLabel` is Apple's shape, and a property the route has to ask
    // about is one it can be told the name of.
    const vcf = [
      "BEGIN:VCARD",
      "item1.TEL:+14165550111",
      "item1.X-ABLABEL:main",
      "item2.X-ABLabel:other",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(vcf)[0].properties).toEqual(["TEL", "X-ABLABEL"]);
  });

  it("#248 H3: reports a line with NO COLON, which is not a content line", () => {
    // `parseContentLine` returned null before `properties.add` ever ran, so a
    // line the RFC does not recognise was dropped by this parser without the
    // route hearing about it — and a message was delivered through it. That a
    // line is malformed is a statement about the format, not about what the
    // person who typed it was trying to say.
    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana",
      "TEL:+14165550111",
      "DO-NOT-CALL",
      "END:VCARD",
    ].join("\r\n");
    const card = parseVCards(vcf)[0];
    expect(card.properties).toContain("DO-NOT-CALL");
    // Still a whole card otherwise: the line is enumerated, not fatal.
    expect(card.tels).toEqual(["+14165550111"]);
    expect(card.name).toBe("Dana");
  });

  it("#248 H3: reports a property whose PARAMETER swallowed the colon", () => {
    // `CATEGORIES;TYPE="a:DNC` — one unbalanced quote, so the only colon on the
    // line reads as quoted and there is no unquoted one to split on. Same drop
    // as above by a different route, and this one loses CATEGORIES: one of the
    // two places a .vcf can say do-not-text, unasked because of a typo.
    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana",
      "TEL:+14165550111",
      'CATEGORIES;TYPE="a:DNC',
      "END:VCARD",
    ].join("\r\n");
    const card = parseVCards(vcf)[0];
    expect(card.properties).toContain("CATEGORIES");
    expect(card.properties).toContain("CATEGORIES;TYPE");
  });

  it("#248 H3: reports PARAMETERS, where Apple's inline label lives", () => {
    // `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…`. The property is TEL, TEL is
    // mapped, and everything after the first `;` was discarded — so the one
    // sentence on the line saying not to text this person was the one part
    // nobody looked at. Apple's OTHER shape, the grouped `item1.X-ABLabel:`
    // line, was always caught, which is what made this look covered.
    //
    // A MIX: a valueless parameter, a parameter on an UNMAPPED property, and a
    // bare property with none, so the enumeration is not "every line has one".
    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana",
      "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550111",
      "EMAIL;PREF:dana@example.com",
      "NOTE:call before 9",
      "END:VCARD",
    ].join("\r\n");
    const card = parseVCards(vcf)[0];
    expect(card.properties).toEqual([
      "FN",
      "TEL",
      "TEL;TYPE",
      "TEL;X-ABLABEL",
      "EMAIL",
      "EMAIL;PREF",
      "NOTE",
    ]);
    // The value is still read: enumerating the parameters must not cost the
    // number the card was carrying.
    expect(card.tels).toEqual(["+16135550111"]);
  });

  it("#248: keeps each card's properties to itself", () => {
    const vcf = [
      "BEGIN:VCARD\nFN:A\nTEL:+14165550111\nCATEGORIES:DNC\nEND:VCARD",
      "BEGIN:VCARD\nFN:B\nTEL:+15125550122\nEND:VCARD",
    ].join("\n");
    const cards = parseVCards(vcf);
    expect(cards[0].properties).toContain("CATEGORIES");
    expect(cards[1].properties).not.toContain("CATEGORIES");
  });

  it("tolerates a missing final END:VCARD", () => {
    const vcf = ["BEGIN:VCARD", "FN:Unterminated", "TEL:+14165550111"].join(
      "\r\n",
    );
    expect(parseVCards(vcf)[0]).toMatchObject({ name: "Unterminated" });
  });

  it("returns [] for input with no VCARD blocks", () => {
    expect(parseVCards("just some text\nnot a vcard")).toEqual([]);
  });

  /**
   * #528 — the two structural shapes that end with a contact assembled from
   * something nobody read. Both are refused rather than half-read, which is one
   * rule instead of two special cases.
   */
  describe("#528: a structurally unreadable .vcf is refused, not half-read", () => {
    it("refuses a card boundary a leading space folded into the line above", () => {
      // The fold rule is RFC-correct, which is what makes it dangerous:
      // ` BEGIN:VCARD` joins the previous `END:VCARD` as one line matching
      // neither delimiter, so card one never closes and swallows card two.
      // Dana's name would import carrying Sam's phone number.
      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        "TEL:+14165550111",
        "END:VCARD",
        " BEGIN:VCARD",
        "FN:Sam Lee",
        "TEL:+15125550122",
        "END:VCARD",
      ].join("\r\n");

      expect(() => parseVCards(vcf)).toThrow(VCardMalformedError);
      // The line is the whole point of the message: the character at fault is
      // invisible, so "look at line 5" is the only actionable part.
      try {
        parseVCards(vcf);
      } catch (cause) {
        expect((cause as VCardMalformedError).kind).toBe("merged-card");
        expect((cause as VCardMalformedError).line).toBe(5);
      }
    });

    it("does NOT refuse an ordinary fold, which is most of what folding is for", () => {
      // The positive control, and the reason the check is on the continuation
      // rather than on a delimiter appearing inside a joined line. A long NOTE
      // wrapped across lines is the ordinary case and has to keep working.
      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        "NOTE:this is a long note that the exporter",
        "  wrapped across two lines",
        "TEL:+14165550111",
        "END:VCARD",
      ].join("\r\n");

      const cards = parseVCards(vcf);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ name: "Dana Diaz" });
    });

    it("does NOT refuse a value that merely mentions a delimiter", () => {
      // A looser test — "a joined line containing BEGIN:VCARD" — would reject
      // this, which is a legitimate import refused over a substring.
      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        "NOTE:the file starts with BEGIN:VCARD and ends with END:VCARD",
        "TEL:+14165550111",
        "END:VCARD",
      ].join("\r\n");

      expect(parseVCards(vcf)).toHaveLength(1);
    });

    it("refuses a content line with no property name", () => {
      // `parseContentLine` returns null for exactly this, and the caller used to
      // `continue` — so neither the property nor its parameters were enumerated
      // and the gate was never asked. A file could say do-not-text on a line
      // nobody was offered the chance to declare.
      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        ";TYPE=DNC:do not call this person",
        "TEL:+14165550111",
        "END:VCARD",
      ].join("\r\n");

      expect(() => parseVCards(vcf)).toThrow(VCardMalformedError);
      try {
        parseVCards(vcf);
      } catch (cause) {
        expect((cause as VCardMalformedError).kind).toBe("nameless-property");
        expect((cause as VCardMalformedError).line).toBe(3);
      }
    });

    it("refuses a bare-colon line too", () => {
      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        ":DO NOT CALL",
        "TEL:+14165550111",
        "END:VCARD",
      ].join("\r\n");
      expect(() => parseVCards(vcf)).toThrow(VCardMalformedError);
    });

    it("ignores a nameless line OUTSIDE a card, which is not ours to judge", () => {
      // Noise between cards is already skipped before parsing, and refusing a
      // file for a blank-ish line in its preamble would reject exports that
      // work everywhere else.
      const vcf = [
        ":stray preamble",
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        "TEL:+14165550111",
        "END:VCARD",
      ].join("\r\n");
      expect(parseVCards(vcf)).toHaveLength(1);
    });
  });
});
