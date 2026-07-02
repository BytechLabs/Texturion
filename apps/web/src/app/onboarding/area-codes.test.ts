import { describe, expect, it } from "vitest";

import {
  areaCodeHint,
  areaCodesForCountry,
  regionName,
  searchAreaCodes,
} from "./area-codes";

describe("searchAreaCodes", () => {
  it("matches a full code and formats the G7 hint", () => {
    const hits = searchAreaCodes("416", "CA");
    expect(hits[0]).toMatchObject({
      code: "416",
      region: "ON",
      regionName: "Ontario",
      label: "(416) — Ontario",
    });
  });

  it("ranks the exact code above longer prefix matches", () => {
    const hits = searchAreaCodes("20", "US");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.code.startsWith("20"))).toBe(true);
    const exact = searchAreaCodes("204", "CA");
    expect(exact[0].code).toBe("204"); // Manitoba
  });

  it("matches typing a city via the area code's timezone city", () => {
    const toronto = searchAreaCodes("Toronto", "CA", 50);
    expect(toronto.map((h) => h.code)).toContain("416");
    const denver = searchAreaCodes("denver", "US", 50);
    expect(denver.map((h) => h.code)).toContain("303");
  });

  it("matches region full names and 2-letter codes", () => {
    const ontario = searchAreaCodes("ontario", "CA", 100);
    expect(ontario.length).toBeGreaterThan(5);
    expect(ontario.every((h) => h.region === "ON")).toBe(true);
    const byCode = searchAreaCodes("ny", "US", 100);
    expect(byCode.some((h) => h.region === "NY")).toBe(true);
  });

  it("never returns codes from the other country", () => {
    expect(searchAreaCodes("416", "US").map((h) => h.code)).not.toContain(
      "416",
    );
    expect(
      searchAreaCodes("Toronto", "US", 100).map((h) => h.code),
    ).not.toContain("416");
  });

  it("returns nothing for empty queries and respects the limit", () => {
    expect(searchAreaCodes("", "US")).toEqual([]);
    expect(searchAreaCodes("   ", "CA")).toEqual([]);
    expect(searchAreaCodes("2", "US", 5)).toHaveLength(5);
  });
});

describe("areaCodeHint", () => {
  it("accepts geographic codes of the chosen country only", () => {
    expect(areaCodeHint("416", "CA")).toMatchObject({ code: "416" });
    expect(areaCodeHint("416", "US")).toBeNull();
  });

  it("rejects unknown and non-geographic codes", () => {
    expect(areaCodeHint("999", "US")).toBeNull(); // unassigned
    expect(areaCodeHint("800", "US")).toBeNull(); // toll-free, not in table
    expect(areaCodeHint("600", "CA")).toBeNull(); // CA non-geographic
  });
});

describe("areaCodesForCountry / regionName", () => {
  it("returns a sorted geographic universe per country", () => {
    const ca = areaCodesForCountry("CA");
    expect(ca.length).toBeGreaterThan(20);
    expect(ca.every((h) => h.country === "CA")).toBe(true);
    const codes = ca.map((h) => h.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it("expands region codes to full names", () => {
    expect(regionName("US", "NY")).toBe("New York");
    expect(regionName("CA", "BC")).toBe("British Columbia");
    expect(regionName("US", "ZZ")).toBe("ZZ"); // graceful fallback
  });
});
