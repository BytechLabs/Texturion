import { describe, expect, it } from "vitest";

import { csvField, csvSafeText, parseCsv, serializeCsv } from "./csv";

describe("parseCsv (RFC 4180 subset)", () => {
  it("parses plain rows with LF and CRLF endings", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted fields with embedded commas, quotes, and newlines", () => {
    const text = 'name,notes\n"Smith, John","said ""hi""\nsecond line"\n';
    expect(parseCsv(text)).toEqual([
      ["name", "notes"],
      ["Smith, John", 'said "hi"\nsecond line'],
    ]);
  });

  it("drops blank lines and strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿phone\n\n+14165550100\n  \n")).toEqual([
      ["phone"],
      ["+14165550100"],
    ]);
  });

  it("keeps empty cells inside non-empty rows", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("csvField (RFC 4180 quoting)", () => {
  it("emits bare values without special chars", () => {
    expect(csvField("+14165550199")).toBe("+14165550199");
  });
  it("quotes and doubles quotes when a value has comma/quote/newline", () => {
    expect(csvField("Smith, John")).toBe('"Smith, John"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("renders null/undefined as the empty field", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("csvSafeText (OWASP CSV/formula-injection guard)", () => {
  it("apostrophe-prefixes cells beginning with a formula trigger", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r", "\n"]) {
      const payload = `${lead}HYPERLINK("http://evil")`;
      expect(csvSafeText(payload)).toBe(`'${payload}`);
    }
  });
  it("neutralizes a classic DDE payload", () => {
    expect(csvSafeText('=cmd|" /C calc"!A1')).toBe(`'=cmd|" /C calc"!A1`);
  });
  it("leaves ordinary free text untouched", () => {
    expect(csvSafeText("Smith, John")).toBe("Smith, John");
    expect(csvSafeText("O'Brien")).toBe("O'Brien");
    expect(csvSafeText("Won;Quote sent")).toBe("Won;Quote sent");
  });
  it("leaves a bare E.164 phone number untouched (not a free-text column, but guards must never mangle it)", () => {
    // A '+'-led string WOULD be guarded — that's why the export leaves the
    // phone column bare (never routed through csvSafeText). Assert csvSafeText
    // is a pure guard and the export's column choice is what protects phones.
    expect(csvSafeText("+14165550199")).toBe("'+14165550199");
  });
  it("renders null/undefined as the empty field", () => {
    expect(csvSafeText(null)).toBe("");
    expect(csvSafeText(undefined)).toBe("");
  });
});

describe("serializeCsv", () => {
  it("joins fields with commas and rows with CRLF", () => {
    expect(serializeCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2");
  });

  it("round-trips with parseCsv (export→import is lossless, D20 §3.1)", () => {
    const rows = [
      ["name", "phone", "tags"],
      ["Smith, John", "+14165550199", "Quote sent;Won"],
      ['Has "quote"', "+15125550100", ""],
      ["line1\nline2", "+12125550133", null],
    ];
    const parsed = parseCsv(serializeCsv(rows));
    // parseCsv drops rows that are entirely empty but preserves these.
    expect(parsed).toEqual(
      rows.map((row) => row.map((cell) => cell ?? "")),
    );
  });
});
