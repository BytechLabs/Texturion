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
      label: "(416) · Ontario",
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

  // Note 1 regression: the curated metro index finds cities whose name is not
  // the head of their IANA timezone (Houston/Dallas share America/Chicago,
  // Charlotte is America/New_York, Calgary is America/Edmonton, …). Each
  // expected NPA is verified against NANPA/CNAC (see city-npas.ts source note).
  it.each([
    ["US", "Houston", "713"],
    ["US", "Houston", "832"],
    ["US", "Dallas", "214"],
    ["US", "San Antonio", "210"],
    ["US", "Charlotte", "704"],
    ["US", "Nashville", "615"],
    ["US", "Columbus", "614"],
    ["US", "Phoenix", "602"],
    ["US", "Seattle", "206"],
    ["US", "Miami", "305"],
    ["US", "Atlanta", "404"],
    ["US", "Boston", "617"],
    ["CA", "Vancouver", "604"],
    ["CA", "Vancouver", "236"],
    ["CA", "Calgary", "403"],
    ["CA", "Edmonton", "780"],
    ["CA", "Winnipeg", "204"],
    ["CA", "Ottawa", "613"],
    ["CA", "Halifax", "902"],
    ["CA", "Montreal", "514"],
  ] as const)(
    "finds %s city %s → NPA %s from the curated index",
    (country, city, code) => {
      const hits = searchAreaCodes(city, country, 50);
      expect(hits.map((h) => h.code)).toContain(code);
    },
  );

  it("keeps curated-city matches in the chosen country only", () => {
    // "London" is a curated CA metro (519/226/548); it must not leak US codes,
    // and a US search for it falls through to region/timezone matching only.
    const londonCa = searchAreaCodes("London", "CA", 50);
    expect(londonCa.map((h) => h.code)).toContain("519");
    expect(londonCa.every((h) => h.country === "CA")).toBe(true);
  });

  it("ranks a curated city match above a bare region-name substring", () => {
    // Typing "Houston" must lead with Houston NPAs, not some unrelated TX code
    // that merely shares the "texas" region string.
    const hits = searchAreaCodes("Houston", "US", 8);
    expect(["713", "281", "832", "346"]).toContain(hits[0].code);
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
