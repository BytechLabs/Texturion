import { describe, expect, it } from "vitest";

import { instantFromZonedWallClock } from "./time";

describe("instantFromZonedWallClock", () => {
  it("uses the stated calendar zone, independent of the dispatcher's browser zone", () => {
    expect(
      instantFromZonedWallClock(
        "2026-11-03T09:30",
        "America/Edmonton",
      ),
    ).toEqual({ ok: true, iso: "2026-11-03T16:30:00.000Z" });
  });

  it("refuses clocks skipped or repeated by DST", () => {
    expect(
      instantFromZonedWallClock(
        "2026-03-08T02:30",
        "America/Edmonton",
      ),
    ).toEqual({ ok: false, reason: "nonexistent" });
    expect(
      instantFromZonedWallClock(
        "2026-11-01T01:30",
        "America/Edmonton",
      ),
    ).toEqual({ ok: false, reason: "ambiguous" });
  });

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
