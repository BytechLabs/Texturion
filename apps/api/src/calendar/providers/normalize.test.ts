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

describe("calendar provider normalization", () => {
  it("resolves the offset at the event date across the fall transition", () => {
    expect(
      instantFromWallClock("2026-11-01T09:00:00", "America/New_York"),
    ).toBe("2026-11-01T14:00:00.000Z");
    expect(
      instantFromWallClock("2026-07-01T09:00:00", "America/New_York"),
    ).toBe("2026-07-01T13:00:00.000Z");
  });

  it("refuses a wall clock that never existed during spring forward", () => {
    expect(
      instantFromWallClock("2026-03-08T02:30:00", "America/New_York"),
    ).toBeNull();
  });

  it("refuses an overlapping wall clock when no offset or fold is provided", () => {
    expect(
      instantFromWallClock("2026-11-01T01:30:00", "America/Edmonton"),
    ).toBeNull();
  });

  it("round trips an Edmonton instant for an outbound Graph event", () => {
    expect(
      wallClockFromInstant("2026-11-01T16:00:00.000Z", "America/Edmonton"),
    ).toBe("2026-11-01T09:00:00");
  });

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
