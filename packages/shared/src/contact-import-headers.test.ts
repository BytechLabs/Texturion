import { describe, expect, it } from "vitest";

import {
  detectContactColumns,
  normalizeContactHeader,
} from "./contact-import-headers";

describe("normalizeContactHeader", () => {
  it("drops case, spaces, and punctuation", () => {
    expect(normalizeContactHeader("Phone Number")).toBe("phonenumber");
    expect(normalizeContactHeader("  E-mail_Address ")).toBe("emailaddress");
  });
});

describe("detectContactColumns", () => {
  it("finds the canonical header", () => {
    expect(
      detectContactColumns(["phone", "name", "address", "notes", "opted_out"]),
    ).toEqual({ phone: 0, name: 1, address: 2, notes: 3, opted_out: 4 });
  });

  it("finds a third-party export's columns", () => {
    // The whole reason this is shared: a file like this imported from a laptop
    // and was rejected from a phone, because only the web rewrote the header.
    expect(
      detectContactColumns([
        "Full Name",
        "Mobile Number",
        "Street Address",
        "Comments",
      ]),
    ).toEqual({ name: 0, phone: 1, address: 2, notes: 3 });
  });

  it("claims a do-not-text column before phone can take it", () => {
    // "Do Not Contact" must not be swallowed by phone's broad `number` pattern.
    const mapping = detectContactColumns(["Do Not Contact", "Cell"]);
    expect(mapping.opted_out).toBe(0);
    expect(mapping.phone).toBe(1);
  });

  it("gives each column to at most one field", () => {
    const mapping = detectContactColumns(["Contact Name", "Contact Number"]);
    expect(mapping.name).toBe(0);
    expect(mapping.phone).toBe(1);
  });

  it("leaves a field absent when nothing matches", () => {
    const mapping = detectContactColumns(["phone"]);
    expect(mapping.phone).toBe(0);
    expect(mapping.name).toBeUndefined();
    expect(mapping.address).toBeUndefined();
  });

  it("returns nothing for an empty header row", () => {
    expect(detectContactColumns([])).toEqual({});
  });
});
