import { describe, expect, it } from "vitest";

import {
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  destinationLocalClock,
  destinationLocalTimeLabel,
  formatNanpAsYouType,
  looksLikePhoneInput,
  normalizeNanpInput,
} from "./e164";

describe("formatNanpAsYouType", () => {
  it("formats progressively as digits arrive", () => {
    expect(formatNanpAsYouType("")).toBe("");
    expect(formatNanpAsYouType("4")).toBe("(4");
    expect(formatNanpAsYouType("416")).toBe("(416");
    expect(formatNanpAsYouType("4165")).toBe("(416) 5");
    expect(formatNanpAsYouType("416555")).toBe("(416) 555");
    expect(formatNanpAsYouType("4165550")).toBe("(416) 555-0");
    expect(formatNanpAsYouType("4165550182")).toBe("(416) 555-0182");
  });

  it("accepts pasted formats: +1, leading 1, punctuation", () => {
    expect(formatNanpAsYouType("+1 416-555-0182")).toBe("(416) 555-0182");
    expect(formatNanpAsYouType("14165550182")).toBe("(416) 555-0182");
    expect(formatNanpAsYouType("(416) 555.0182")).toBe("(416) 555-0182");
  });

  it("ignores overflow digits past 10", () => {
    expect(formatNanpAsYouType("41655501829999")).toBe("(416) 555-0182");
  });
});

describe("normalizeNanpInput", () => {
  it("returns strict E.164 for valid US/CA numbers", () => {
    expect(normalizeNanpInput("(416) 555-0182")).toBe("+14165550182");
    expect(normalizeNanpInput("+1 212 555 0100")).toBe("+12125550100");
    expect(normalizeNanpInput("12125550100")).toBe("+12125550100");
  });

  it("rejects incomplete, non-NANP, and Caribbean +1 numbers", () => {
    expect(normalizeNanpInput("")).toBeNull();
    expect(normalizeNanpInput("416555")).toBeNull();
    expect(normalizeNanpInput("+44 20 7946 0958")).toBeNull();
    // 876 = Jamaica: +1 but not a US/CA destination (SPEC §10 layer 2).
    expect(normalizeNanpInput("8765550100")).toBeNull();
    // 800 toll-free is not a texting destination either.
    expect(normalizeNanpInput("8005550100")).toBeNull();
  });
});

describe("looksLikePhoneInput", () => {
  it("distinguishes numbers from name searches", () => {
    expect(looksLikePhoneInput("416")).toBe(true);
    expect(looksLikePhoneInput("(416) 5")).toBe(true);
    expect(looksLikePhoneInput("Maria")).toBe(false);
    expect(looksLikePhoneInput("maria 2")).toBe(false);
  });
});

/**
 * #225 — the composer tells the sender what o'clock it is for the recipient,
 * and the hour decides whether that reads as a fact or a warning.
 *
 * Boundary table shared with the server's destination-clock.test.ts and the
 * Kotlin/Swift twins: one rule, three hand-ports, asserted rather than assumed.
 */
describe("destinationLocalClock", () => {
  // 2026-07-01T16:00Z is 12:00 in America/Toronto (416) and 09:00 in
  // America/Los_Angeles (415) — a fixed instant, so this cannot drift.
  const MIDDAY_UTC = new Date("2026-07-01T16:00:00.000Z");
  const TORONTO = "+14165550100";
  const LA = "+14155550100";

  it("reads the wall clock in the destination's zone, not ours", () => {
    expect(destinationLocalClock(TORONTO, MIDDAY_UTC)?.hour).toBe(12);
    expect(destinationLocalClock(LA, MIDDAY_UTC)?.hour).toBe(9);
  });

  it("labels the time the way the copy reads it", () => {
    expect(destinationLocalClock(TORONTO, MIDDAY_UTC)?.label).toBe("12:00 PM");
    expect(destinationLocalClock(LA, MIDDAY_UTC)?.label).toBe("9:00 AM");
  });

  it("calls an ordinary hour not quiet", () => {
    expect(destinationLocalClock(TORONTO, MIDDAY_UTC)?.quiet).toBe(false);
    expect(destinationLocalClock(LA, MIDDAY_UTC)?.quiet).toBe(false);
  });

  it("calls a late hour quiet — 23:00 in Toronto", () => {
    const lateUtc = new Date("2026-07-02T03:00:00.000Z");
    const clock = destinationLocalClock(TORONTO, lateUtc);
    expect(clock?.hour).toBe(23);
    expect(clock?.quiet).toBe(true);
  });

  it("handles midnight, where hour12:false can render 24", () => {
    // 04:00Z on 2026-07-02 is midnight in Toronto. A raw 24 here would fall
    // outside the window check and call midnight sendable.
    const clock = destinationLocalClock(TORONTO, new Date("2026-07-02T04:00:00.000Z"));
    expect(clock?.hour).toBe(0);
    expect(clock?.quiet).toBe(true);
  });

  it("is null where we do not know the zone", () => {
    // Toll-free carries no geography, so there is no honest hint to show.
    expect(destinationLocalClock("+18005550100", MIDDAY_UTC)).toBeNull();
  });

  it("keeps destinationLocalTimeLabel agreeing with it", () => {
    // The dialog copy reads through the old helper; it must not drift.
    expect(destinationLocalTimeLabel(TORONTO, MIDDAY_UTC)).toBe(
      destinationLocalClock(TORONTO, MIDDAY_UTC)?.label,
    );
    expect(destinationLocalTimeLabel("+18005550100", MIDDAY_UTC)).toBeNull();
  });

  it("pins the window boundaries the other two clients port", () => {
    expect(QUIET_HOURS_START).toBe(20);
    expect(QUIET_HOURS_END).toBe(8);
    const quiet = (hour: number) =>
      hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
    expect(quiet(7)).toBe(true);
    expect(quiet(8)).toBe(false);
    expect(quiet(19)).toBe(false);
    expect(quiet(20)).toBe(true);
    expect(quiet(0)).toBe(true);
  });
});
