import { describe, expect, it } from "vitest";
import {
  appendUnlinkNote,
  hashCalendarDescription,
  instantFromWallClock,
  normalizeCalendarScheduleSnapshot,
  wallClockFromInstant,
} from "./normalize";
import {
  ianaZoneToWindows,
  WINDOWS_TO_IANA,
  windowsZoneToIana,
} from "./windows-zones";

/**
 * tzdata 2026c made Alberta permanent UTC-6 from 2026-11-01, so what
 * America/Edmonton does that day depends on the runtime's tzdata release.
 * The era comes from the release name rather than from probing Intl: a probe
 * would let a runtime with wrong Alberta rules file itself under whichever era
 * matches its wrong answer, and the era's assertions would then agree with it.
 *
 * Keep in step with its web twin, apps/web/src/test/tzdata-era.ts.
 */
function tzdataEra(release: string | undefined): "pre-2026c" | "2026c+" | null {
  const match = /^(\d{4})([a-z])$/.exec(release ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  return year < 2026 || (year === 2026 && match[2] < "c")
    ? "pre-2026c"
    : "2026c+";
}

const TZDATA_RELEASE = process.versions.tz;
const TZDATA_ERA = tzdataEra(TZDATA_RELEASE);

// Every tzdata release in use agrees on these zones' 2026 transitions. Alberta
// does not, which is why it has its own era-aware block below.
const STABLE_DST_ZONES = ["America/New_York", "America/Toronto"] as const;

describe("calendar provider normalization", () => {
  it("resolves the offset at the event date across the fall transition", () => {
    expect(
      instantFromWallClock("2026-11-01T09:00:00", "America/New_York"),
    ).toBe("2026-11-01T14:00:00.000Z");
    expect(
      instantFromWallClock("2026-07-01T09:00:00", "America/New_York"),
    ).toBe("2026-07-01T13:00:00.000Z");
  });

  it.each(STABLE_DST_ZONES)(
    "refuses %s 2026-03-08T02:30, a wall clock spring-forward skipped",
    (zone) => {
      expect(wallClockFromInstant("2026-03-08T06:59:59.000Z", zone)).toBe(
        "2026-03-08T01:59:59",
      );
      expect(wallClockFromInstant("2026-03-08T07:00:00.000Z", zone)).toBe(
        "2026-03-08T03:00:00",
      );
      expect(instantFromWallClock("2026-03-08T02:30:00", zone)).toBeNull();
    },
  );

  it.each(STABLE_DST_ZONES)(
    "refuses %s 2026-11-01T01:30, a wall clock fall-back repeats, when no offset or fold is provided",
    (zone) => {
      expect(wallClockFromInstant("2026-11-01T05:30:00.000Z", zone)).toBe(
        "2026-11-01T01:30:00",
      );
      expect(wallClockFromInstant("2026-11-01T06:30:00.000Z", zone)).toBe(
        "2026-11-01T01:30:00",
      );
      expect(instantFromWallClock("2026-11-01T01:30:00", zone)).toBeNull();
    },
  );

  it("hashes normalized provider text without retaining customer text", async () => {
    await expect(hashCalendarDescription("Cafe\u0301\r\nUnit 4")).resolves.toBe(
      await hashCalendarDescription("Caf\u00e9\nUnit 4"),
    );
    await expect(hashCalendarDescription("private note")).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("builds a canonical scheduling snapshot and rejects impossible ranges", async () => {
    await expect(
      normalizeCalendarScheduleSnapshot({
        start: "2026-11-01T09:00:00-07:00",
        end: "2026-11-01T10:00:00-07:00",
        timeZone: "America/Edmonton",
        title: "Cafe\u0301",
        description: "Unit 4\r\nRear",
      }),
    ).resolves.toMatchObject({
      start: "2026-11-01T16:00:00.000Z",
      end: "2026-11-01T17:00:00.000Z",
      timeZone: "America/Edmonton",
      title: "Caf\u00e9",
      descriptionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expect(
      normalizeCalendarScheduleSnapshot({
        start: "2026-11-01T10:00:00Z",
        end: "2026-11-01T09:00:00Z",
        timeZone: "America/Edmonton",
        title: "Backwards",
        description: "",
      }),
    ).resolves.toBeNull();
  });

  it("appends the unlink note once", () => {
    expect(appendUnlinkNote("Bring ladder\n", "Removed in Loonext")).toBe(
      "Bring ladder\n\nRemoved in Loonext",
    );
    expect(
      appendUnlinkNote(
        "Bring ladder\n\nRemoved in Loonext",
        "Removed in Loonext",
      ),
    ).toBe("Bring ladder\n\nRemoved in Loonext");
  });

  it("covers every CLDR primary Windows zone with an accepted IANA zone", () => {
    expect(Object.keys(WINDOWS_TO_IANA)).toHaveLength(139);
    for (const [windows, iana] of Object.entries(WINDOWS_TO_IANA)) {
      expect(windowsZoneToIana(windows), windows).toBe(iana);
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: iana })).not.toThrow();
    }
    expect(windowsZoneToIana("Eastern Standard Time")).toBe(
      "America/New_York",
    );
    expect(ianaZoneToWindows("America/Edmonton")).toBe(
      "Mountain Standard Time",
    );
    expect(windowsZoneToIana("Made Up Standard Time")).toBeNull();
  });
});

describe(`Alberta (America/Edmonton) on tzdata ${TZDATA_RELEASE ?? "unknown"}, era ${TZDATA_ERA ?? "unclassified"}`, () => {
  const zone = "America/Edmonton";

  it("runs on a tzdata release whose Alberta rules this suite knows", () => {
    expect(
      TZDATA_ERA,
      `process.versions.tz is ${String(TZDATA_RELEASE)}`,
    ).not.toBeNull();
  });

  it("refuses 2026-03-08T02:30, which spring-forward skipped in every era", () => {
    expect(instantFromWallClock("2026-03-08T02:30:00", zone)).toBeNull();
  });

  if (TZDATA_ERA === "pre-2026c") {
    it("pre-2026c: refuses 2026-11-01T01:30, which fall-back repeats", () => {
      expect(wallClockFromInstant("2026-11-01T07:30:00.000Z", zone)).toBe(
        "2026-11-01T01:30:00",
      );
      expect(wallClockFromInstant("2026-11-01T08:30:00.000Z", zone)).toBe(
        "2026-11-01T01:30:00",
      );
      expect(instantFromWallClock("2026-11-01T01:30:00", zone)).toBeNull();
    });

    it("pre-2026c: round trips 2026-11-01T16:00Z as 09:00 local", () => {
      expect(wallClockFromInstant("2026-11-01T16:00:00.000Z", zone)).toBe(
        "2026-11-01T09:00:00",
      );
      expect(instantFromWallClock("2026-11-01T09:00:00", zone)).toBe(
        "2026-11-01T16:00:00.000Z",
      );
    });

    it("pre-2026c: is UTC-7 in January 2027", () => {
      expect(wallClockFromInstant("2027-01-15T18:00:00.000Z", zone)).toBe(
        "2027-01-15T11:00:00",
      );
      expect(instantFromWallClock("2027-01-15T11:00:00", zone)).toBe(
        "2027-01-15T18:00:00.000Z",
      );
    });
  }

  if (TZDATA_ERA === "2026c+") {
    it("2026c+: resolves 2026-11-01T01:30 to its only instant, as Alberta no longer falls back", () => {
      expect(instantFromWallClock("2026-11-01T01:30:00", zone)).toBe(
        "2026-11-01T07:30:00.000Z",
      );
    });

    it("2026c+: round trips 2026-11-01T16:00Z as 10:00 local", () => {
      expect(wallClockFromInstant("2026-11-01T16:00:00.000Z", zone)).toBe(
        "2026-11-01T10:00:00",
      );
      expect(instantFromWallClock("2026-11-01T10:00:00", zone)).toBe(
        "2026-11-01T16:00:00.000Z",
      );
    });

    it("2026c+: is UTC-6 in January 2027", () => {
      expect(wallClockFromInstant("2027-01-15T18:00:00.000Z", zone)).toBe(
        "2027-01-15T12:00:00",
      );
      expect(instantFromWallClock("2027-01-15T12:00:00", zone)).toBe(
        "2027-01-15T18:00:00.000Z",
      );
    });
  }
});
