/**
 * Hand-rolled vCard parser (D20 §3.2): vCard 3.0 + 4.0, multi-card files, line
 * folding, TEL params + tel: URIs, grouped properties, FN/N name extraction.
 */
import { describe, expect, it } from "vitest";

import { parseVCards } from "./vcard";

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
      { name: "Alice Adams", tels: ["(416) 555-0111"] },
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
    expect(parseVCards(vcf)).toEqual([{ name: "No Phone", tels: [] }]);
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
});
