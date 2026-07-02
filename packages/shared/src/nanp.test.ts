import { describe, expect, it } from "vitest";
import {
  NANP_AREA_CODES,
  destinationLocalHour,
  isUsCaDestination,
  lookupAreaCode,
} from "./nanp";

describe("NANP_AREA_CODES table", () => {
  it("carries every in-service US/CA code from the NANPA report (446 as of 07/01/2026)", () => {
    expect(Object.keys(NANP_AREA_CODES)).toHaveLength(446);
  });

  it("every key is a valid NXX area code", () => {
    for (const code of Object.keys(NANP_AREA_CODES)) {
      expect(code).toMatch(/^[2-9]\d{2}$/);
    }
  });

  it("every geographic entry has a 2-letter region and an Intl-resolvable IANA timezone", () => {
    const timezones = new Set<string>();
    for (const entry of Object.values(NANP_AREA_CODES)) {
      expect(["US", "CA"]).toContain(entry.country);
      if (entry.geographic) {
        expect(entry.region).toMatch(/^[A-Z]{2}$/);
        timezones.add(entry.timezone);
      } else {
        expect(entry.region).toBeNull();
        expect(entry.timezone).toBeNull();
      }
    }
    expect(timezones.size).toBeGreaterThan(10);
    for (const timezone of timezones) {
      // Throws RangeError on an invalid IANA identifier.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: timezone })).not.toThrow();
    }
  });

  it("overlay codes share their parent's region and timezone", () => {
    const overlayFamilies: string[][] = [
      ["208", "986"], // Idaho
      ["850", "448"], // Florida panhandle
      ["812", "930"], // southern Indiana
      ["423", "729", "865"], // eastern Tennessee
      ["416", "647", "437", "942"], // Toronto
      ["709", "879"], // Newfoundland and Labrador
      ["902", "782"], // NS + PE
      ["270", "364"], // western Kentucky
    ];
    for (const [parent, ...overlays] of overlayFamilies) {
      for (const overlay of overlays) {
        expect(NANP_AREA_CODES[overlay], `${overlay} vs ${parent}`).toEqual(NANP_AREA_CODES[parent]);
      }
    }
  });

  it("excludes Caribbean NANP and NANP-wide shared service codes", () => {
    for (const code of ["242", "264", "809", "829", "876", "658", "800", "833", "888", "900", "500", "700"]) {
      expect(NANP_AREA_CODES[code], code).toBeUndefined();
    }
  });
});

describe("lookupAreaCode", () => {
  it("resolves Canadian codes to the right province and timezone", () => {
    expect(lookupAreaCode("+14165550123")).toEqual({
      country: "CA",
      geographic: true,
      region: "ON",
      timezone: "America/Toronto",
    });
    expect(lookupAreaCode("+16045550123")).toEqual({
      country: "CA",
      geographic: true,
      region: "BC",
      timezone: "America/Vancouver",
    });
    expect(lookupAreaCode("+19025550123")).toEqual({
      country: "CA",
      geographic: true,
      region: "NS",
      timezone: "America/Halifax",
    });
  });

  it("resolves US codes to the right state and timezone", () => {
    expect(lookupAreaCode("+12125550123")).toEqual({
      country: "US",
      geographic: true,
      region: "NY",
      timezone: "America/New_York",
    });
    expect(lookupAreaCode("+13055550123")).toEqual({
      country: "US",
      geographic: true,
      region: "FL",
      timezone: "America/New_York",
    });
    expect(lookupAreaCode("+19075550123")).toEqual({
      country: "US",
      geographic: true,
      region: "AK",
      timezone: "America/Anchorage",
    });
    expect(lookupAreaCode("+18085550123")).toEqual({
      country: "US",
      geographic: true,
      region: "HI",
      timezone: "Pacific/Honolulu",
    });
  });

  it("resolves US/CA non-geographic codes without region or timezone", () => {
    expect(lookupAreaCode("+17105550123")).toEqual({
      country: "US",
      geographic: false,
      region: null,
      timezone: null,
    });
    expect(lookupAreaCode("+16005550123")).toEqual({
      country: "CA",
      geographic: false,
      region: null,
      timezone: null,
    });
  });

  it("returns null for Jamaica (876) — Caribbean NANP is not US/CA", () => {
    expect(lookupAreaCode("+18765550123")).toBeNull();
  });

  it("returns null for unassigned 555", () => {
    expect(lookupAreaCode("+15555550123")).toBeNull();
  });

  it("returns null for malformed input (strict +1NXXNXXXXXX only)", () => {
    for (const bad of [
      "",
      "4165550123", // no +1
      "14165550123", // no +
      "+4165550123", // wrong country code
      "+441655501234", // UK
      "+1416555012", // 9 national digits
      "+141655501234", // 11 national digits
      "+1 416 555 0123", // spaces
      "+1-416-555-0123", // dashes
      "+11165550123", // area code starts with 1
      "+10165550123", // area code starts with 0
      "+14161550123x", // trailing junk
      "+14160550123", // exchange starts with 0
      "+14161550123 ", // trailing space
      "+1416555O123", // letter O
    ]) {
      expect(lookupAreaCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("isUsCaDestination (SMS-pumping destination check)", () => {
  it("accepts US and CA geographic and non-geographic destinations", () => {
    expect(isUsCaDestination("+12125550123")).toBe(true);
    expect(isUsCaDestination("+16045550123")).toBe(true);
    expect(isUsCaDestination("+17105550123")).toBe(true);
  });

  it("rejects Caribbean NANP, toll-free/NANP-wide, unassigned, and malformed", () => {
    expect(isUsCaDestination("+18765550123")).toBe(false); // Jamaica
    expect(isUsCaDestination("+12425550123")).toBe(false); // Bahamas
    expect(isUsCaDestination("+18095550123")).toBe(false); // Dominican Republic
    expect(isUsCaDestination("+18005550123")).toBe(false); // toll-free (NANP-wide)
    expect(isUsCaDestination("+15555550123")).toBe(false); // unassigned
    expect(isUsCaDestination("+447911123456")).toBe(false); // not +1 at all
    expect(isUsCaDestination("2125550123")).toBe(false); // not E.164
  });
});

describe("destinationLocalHour (quiet-hours math, SPEC §5)", () => {
  // One known winter instant across four zones (incl. a half-hour offset).
  const winter = new Date("2026-01-15T17:00:00Z");

  it("computes the local hour across timezones for a known instant", () => {
    expect(destinationLocalHour("+12125550123", winter)).toBe(12); // NY, EST −5
    expect(destinationLocalHour("+16045550123", winter)).toBe(9); // Vancouver, PST −8
    expect(destinationLocalHour("+19025550123", winter)).toBe(13); // Halifax, AST −4
    expect(destinationLocalHour("+17095550123", winter)).toBe(13); // St. John's, NST −3:30 → 13:30
    expect(destinationLocalHour("+19075550123", winter)).toBe(8); // Anchorage, AKST −9
    expect(destinationLocalHour("+18085550123", winter)).toBe(7); // Honolulu, −10
  });

  it("handles the US spring-forward DST edge (2026-03-08, America/New_York)", () => {
    // 06:59Z is 01:59 EST; two minutes later the 2am hour has been skipped.
    expect(destinationLocalHour("+12125550123", new Date("2026-03-08T06:59:00Z"))).toBe(1);
    expect(destinationLocalHour("+12125550123", new Date("2026-03-08T07:01:00Z"))).toBe(3);
  });

  it("respects zones that never shift: Phoenix and Regina, winter vs summer", () => {
    const summer = new Date("2026-07-15T17:00:00Z");
    // Phoenix stays MST (−7) through the DST edge and all year.
    expect(destinationLocalHour("+16025550123", new Date("2026-03-08T07:01:00Z"))).toBe(0);
    expect(destinationLocalHour("+16025550123", summer)).toBe(10);
    // Saskatchewan stays CST (−6) year-round while Winnipeg shifts to CDT (−5).
    expect(destinationLocalHour("+13065550123", winter)).toBe(11);
    expect(destinationLocalHour("+13065550123", summer)).toBe(11);
    expect(destinationLocalHour("+12045550123", winter)).toBe(11);
    expect(destinationLocalHour("+12045550123", summer)).toBe(12);
  });

  it("crosses the date line correctly (Guam, UTC+10)", () => {
    // 17:00Z Jan 15 = 03:00 Jan 16 in Guam.
    expect(destinationLocalHour("+16715550123", winter)).toBe(3);
  });

  it("returns null for non-geographic, non-US/CA, malformed numbers and invalid dates", () => {
    expect(destinationLocalHour("+17105550123", winter)).toBeNull(); // non-geographic
    expect(destinationLocalHour("+18765550123", winter)).toBeNull(); // Jamaica
    expect(destinationLocalHour("garbage", winter)).toBeNull();
    expect(destinationLocalHour("+12125550123", new Date(Number.NaN))).toBeNull();
  });
});
