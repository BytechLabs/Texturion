import { describe, expect, it } from "vitest";

import {
  autoDetectMapping,
  buildImportCsv,
  buildPreview,
  csvEscape,
  normalizeNanpPhone,
  skippedRowsCsv,
  summarizePreview,
} from "./csv-import";

describe("autoDetectMapping", () => {
  it("maps the canonical header exactly", () => {
    expect(
      autoDetectMapping(["phone", "name", "address", "notes", "opted_out"]),
    ).toEqual({ phone: 0, name: 1, address: 2, notes: 3, opted_out: 4 });
  });

  it("detects messy real-world headers", () => {
    expect(
      autoDetectMapping([
        "Customer Name",
        "Mobile #",
        "Street Address",
        "Comments",
        "Do Not Text",
      ]),
    ).toEqual({ name: 0, phone: 1, address: 2, notes: 3, opted_out: 4 });
  });

  it("never claims an opt-out column for phone despite the 'number' pattern", () => {
    const mapping = autoDetectMapping(["Opt Out", "Phone Number"]);
    expect(mapping.opted_out).toBe(0);
    expect(mapping.phone).toBe(1);
  });

  it("claims each column at most once", () => {
    const mapping = autoDetectMapping(["phone", "phone 2"]);
    expect(mapping.phone).toBe(0);
    expect(Object.values(mapping)).toEqual([0]);
  });

  it("leaves unrecognized headers unmapped", () => {
    expect(autoDetectMapping(["frobnicator", "widget"])).toEqual({});
  });
});

describe("normalizeNanpPhone (API mirror)", () => {
  it("normalizes human formats to E.164", () => {
    expect(normalizeNanpPhone("(416) 555-0199")).toBe("+14165550199");
    expect(normalizeNanpPhone("1-212-555-0100")).toBe("+12125550100");
    expect(normalizeNanpPhone("+12125550100")).toBe("+12125550100");
  });

  it("rejects non-NANP and unassigned area codes", () => {
    expect(normalizeNanpPhone("+442071234567")).toBeNull(); // UK
    expect(normalizeNanpPhone("(999) 555-0100")).toBeNull(); // unassigned NPA
    expect(normalizeNanpPhone("555-0100")).toBeNull(); // too short
    expect(normalizeNanpPhone("")).toBeNull();
  });
});

describe("buildPreview (dry-run row statuses)", () => {
  const mapping = { phone: 0, name: 1, opted_out: 2 } as const;

  it("marks valid rows ready with the normalized phone", () => {
    const [row] = buildPreview([["(416) 555-0199", "Sam", ""]], mapping);
    expect(row.status).toBe("ready");
    expect(row.phoneE164).toBe("+14165550199");
    expect(row.optedOut).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.rowNumber).toBe(2); // header is line 1, like the API
  });

  it("marks invalid phones with the API's reason wording", () => {
    const rows = buildPreview([["nope", "A", ""], ["", "B", ""]], mapping);
    expect(rows[0].status).toBe("invalid_phone");
    expect(rows[0].reason).toBe("invalid phone: nope");
    expect(rows[1].reason).toBe("invalid phone: (empty)");
  });

  it("marks later duplicates of the same normalized phone", () => {
    const rows = buildPreview(
      [
        ["4165550199", "First", ""],
        ["(416) 555-0199", "Second", ""],
      ],
      mapping,
    );
    expect(rows[0].status).toBe("ready");
    expect(rows[1].status).toBe("duplicate");
    expect(rows[1].reason).toBe("duplicate phone in file: +14165550199");
    expect(rows[1].rowNumber).toBe(3);
  });

  it("applies the API's truthy set to opted_out", () => {
    const rows = buildPreview(
      [
        ["4165550101", "", "true"],
        ["4165550102", "", "YES"],
        ["4165550103", "", "1"],
        ["4165550104", "", "y"],
        ["4165550105", "", "no"],
        ["4165550106", "", ""],
      ],
      mapping,
    );
    expect(rows.map((r) => r.optedOut)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("ignores opted_out cells when the column is unmapped", () => {
    const [row] = buildPreview([["4165550101", "Sam", "true"]], {
      phone: 0,
      name: 1,
    });
    expect(row.optedOut).toBe(false);
  });
});

describe("summarizePreview", () => {
  it("counts ready, skipped, and opted-out rows", () => {
    const rows = buildPreview(
      [
        ["4165550101", "", "true"],
        ["4165550101", "", ""],
        ["bad", "", ""],
        ["4165550102", "", ""],
      ],
      { phone: 0, name: 1, opted_out: 2 },
    );
    expect(summarizePreview(rows)).toEqual({
      ready: 2,
      skipped: 2,
      optedOut: 1,
    });
  });
});

describe("buildImportCsv", () => {
  it("emits only mapped columns under the canonical header, all rows included", () => {
    const csv = buildImportCsv(
      [
        ["Sam", "4165550199"],
        ["Bad", "nope"],
      ],
      { phone: 1, name: 0 },
    );
    expect(csv).toBe(
      "phone,name\r\n4165550199,Sam\r\nnope,Bad",
    );
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    expect(csvEscape('he said "hi", twice')).toBe(
      '"he said ""hi"", twice"',
    );
    const csv = buildImportCsv([["4165550199", 'Sam "Sammy" O, Jr.']], {
      phone: 0,
      name: 1,
    });
    expect(csv.split("\r\n")[1]).toBe('4165550199,"Sam ""Sammy"" O, Jr."');
  });
});

describe("skippedRowsCsv", () => {
  it("joins API error rows back to the original values by row number", () => {
    const preview = buildPreview(
      [
        ["4165550199", "Sam", ""],
        ["nope", "Pat", ""],
      ],
      { phone: 0, name: 1, opted_out: 2 },
    );
    const csv = skippedRowsCsv(
      [{ row: 3, reason: "invalid phone: nope" }],
      preview,
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("phone,name,address,notes,opted_out,reason");
    expect(lines[1]).toBe("nope,Pat,,,,invalid phone: nope");
  });
});
