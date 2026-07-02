import { describe, expect, it } from "vitest";

import { normalizeNanpPhone, normalizeWebsite } from "./normalize";
import { parseDraft } from "./local-draft";

describe("normalizeWebsite", () => {
  it("prepends https:// when the scheme is missing", () => {
    expect(normalizeWebsite("mikesplumbing.com")).toBe(
      "https://mikesplumbing.com",
    );
  });
  it("keeps explicit schemes and trims whitespace", () => {
    expect(normalizeWebsite("  http://mikes.ca ")).toBe("http://mikes.ca");
    expect(normalizeWebsite("https://mikes.ca")).toBe("https://mikes.ca");
  });
  it("leaves empty input empty (website is optional for sole props)", () => {
    expect(normalizeWebsite("   ")).toBe("");
  });
});

describe("normalizeNanpPhone", () => {
  it("normalizes human formats to E.164", () => {
    expect(normalizeNanpPhone("(416) 555-0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("416-555-0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("1 416 555 0182")).toBe("+14165550182");
    expect(normalizeNanpPhone("+14165550182")).toBe("+14165550182");
  });
  it("rejects short numbers and non-US/CA destinations", () => {
    expect(normalizeNanpPhone("555-0182")).toBeNull();
    // 809 is Dominican Republic — in the NANP but not a US/CA destination.
    expect(normalizeNanpPhone("(809) 555-0100")).toBeNull();
    // 800 toll-free is not a geographic US/CA code either.
    expect(normalizeNanpPhone("800 555 0100")).toBeNull();
  });
});

describe("parseDraft", () => {
  it("parses a valid draft and drops junk fields", () => {
    expect(
      parseDraft(
        JSON.stringify({
          name: "Mike's",
          country: "CA",
          areaCode: "416",
          usTexting: false,
          extra: "ignored",
        }),
      ),
    ).toEqual({ name: "Mike's", country: "CA", areaCode: "416", usTexting: false });
  });
  it("drops malformed values instead of throwing", () => {
    expect(parseDraft("not json")).toEqual({});
    expect(parseDraft(JSON.stringify({ country: "MX", areaCode: "41" }))).toEqual(
      {},
    );
    expect(parseDraft(null)).toEqual({});
  });
});
