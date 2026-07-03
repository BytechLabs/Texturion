import { describe, expect, it } from "vitest";

import { csvField, parseCsv, serializeCsv } from "./csv";

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
