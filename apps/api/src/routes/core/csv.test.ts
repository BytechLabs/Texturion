import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

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
