import { describe, expect, it } from "vitest";

import { TZDATA_ERA, TZDATA_RELEASE } from "@/test/tzdata-era";

import { instantFromZonedWallClock } from "./time";

describe("instantFromZonedWallClock", () => {
  // Every tzdata release in use agrees on these zones. Etc/GMT+6 is UTC-6 by
  // definition (POSIX sign). Alberta does not agree, which is why it has its
  // own era-aware block below.
  it.each([
    ["America/New_York", "2026-11-03T14:30:00.000Z"],
    ["Etc/GMT+6", "2026-11-03T15:30:00.000Z"],
    ["Asia/Tokyo", "2026-11-03T00:30:00.000Z"],
  ])(
    "uses the stated calendar zone, independent of the dispatcher's browser zone (%s)",
    (zone, iso) => {
      expect(instantFromZonedWallClock("2026-11-03T09:30", zone)).toEqual({
        ok: true,
        iso,
      });
    },
  );

  it.each(["America/New_York", "America/Toronto"])(
    "refuses clocks skipped or repeated by DST in %s",
    (zone) => {
      expect(instantFromZonedWallClock("2026-03-08T02:30", zone)).toEqual({
        ok: false,
        reason: "nonexistent",
      });
      expect(instantFromZonedWallClock("2026-11-01T01:30", zone)).toEqual({
        ok: false,
        reason: "ambiguous",
      });
    },
  );

  it("rejects malformed clocks and unknown zones", () => {
    expect(instantFromZonedWallClock("2026-02-30T09:00", "UTC")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(instantFromZonedWallClock("2026-02-28T09:00", "Mars/Base")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe(`instantFromZonedWallClock in Alberta (America/Edmonton) on tzdata ${TZDATA_RELEASE ?? "unknown"}, era ${TZDATA_ERA ?? "unclassified"}`, () => {
  const zone = "America/Edmonton";

  it("runs on a tzdata release whose Alberta rules this suite knows", () => {
    expect(
      TZDATA_ERA,
      `process.versions.tz is ${String(TZDATA_RELEASE)}`,
    ).not.toBeNull();
  });

  it("refuses 2026-03-08T02:30, which spring-forward skipped in every era", () => {
    expect(instantFromZonedWallClock("2026-03-08T02:30", zone)).toEqual({
      ok: false,
      reason: "nonexistent",
    });
  });

  if (TZDATA_ERA === "pre-2026c") {
    it("pre-2026c: refuses 2026-11-01T01:30, which fall-back repeats", () => {
      expect(instantFromZonedWallClock("2026-11-01T01:30", zone)).toEqual({
        ok: false,
        reason: "ambiguous",
      });
    });

    it("pre-2026c: reads 2026-11-03T09:30 at UTC-7", () => {
      expect(instantFromZonedWallClock("2026-11-03T09:30", zone)).toEqual({
        ok: true,
        iso: "2026-11-03T16:30:00.000Z",
      });
    });
  }

  if (TZDATA_ERA === "2026c+") {
    it("2026c+: reads 2026-11-01T01:30 as its only instant, as Alberta no longer falls back", () => {
      expect(instantFromZonedWallClock("2026-11-01T01:30", zone)).toEqual({
        ok: true,
        iso: "2026-11-01T07:30:00.000Z",
      });
    });

    it("2026c+: reads 2026-11-03T09:30 at UTC-6", () => {
      expect(instantFromZonedWallClock("2026-11-03T09:30", zone)).toEqual({
        ok: true,
        iso: "2026-11-03T15:30:00.000Z",
      });
    });
  }
});
