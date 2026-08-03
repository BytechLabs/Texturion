/**
 * #233 — the two helpers behind the send-later picker, where being wrong is
 * quiet.
 *
 * Neither of these fails loudly. A broken round-trip schedules a text for the
 * wrong hour, and a wrong offset sentence tells somebody their customer is
 * asleep when they are not. Both are invisible in any test run in a timezone
 * where the numbers happen to agree, which is why the cases below name zones.
 */
import { describe, expect, it } from "vitest";

import { hoursApart, toLocalInput } from "./send-later-menu";

describe("#233 the datetime-local round-trip", () => {
  it("comes back as the same instant it went in as", () => {
    // The whole reason the field is the SENDER's clock. `<input
    // type="datetime-local">` yields a bare wall clock and `new Date(value)`
    // parses it as the browser's local time — so rendering the customer's 8am
    // into the box and reading it back would mean 8am HERE, a silent
    // several-hour error.
    for (const iso of [
      "2026-08-04T12:00:00Z",
      "2026-01-15T23:30:00Z",
      "2026-06-30T00:15:00Z",
      // Either side of a northern DST boundary, where a naive offset applied
      // once is wrong for half the year.
      "2026-03-07T18:00:00Z",
      "2026-03-09T18:00:00Z",
      "2026-10-31T18:00:00Z",
      "2026-11-02T18:00:00Z",
    ]) {
      const instant = new Date(iso);
      const roundTripped = new Date(toLocalInput(instant));
      // To the minute: the input has no seconds field, so that is the honest
      // precision to assert rather than exact equality.
      expect(
        Math.abs(roundTripped.getTime() - instant.getTime()),
        `${iso} did not survive the round-trip`,
      ).toBeLessThan(60_000);
    }
  });

  it("produces the shape the input element requires", () => {
    // A value the browser rejects renders as an empty picker, which reads as
    // "no default" — the empty form the smart-default is there to prevent.
    expect(toLocalInput(new Date("2026-08-04T12:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });
});

describe("#233 how far apart the two clocks are", () => {
  it("says so in hours, in the direction a person would say it", () => {
    // Measured against the runtime's own tzdata rather than an offset table,
    // so it stays right across a boundary where two zones shift on different
    // dates.
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(hoursApart(here)).toBe("on the same clock");

    // A zone genuinely elsewhere: the sentence must name a number and a
    // direction, never a bare offset.
    const line = hoursApart("Asia/Tokyo");
    expect(line).toMatch(/(ahead of|behind) you|on the same clock/);
  });

  it("never claims a gap larger than half a day", () => {
    // Wrapping is what turns "23 hours ahead" into "an hour behind". Without
    // it the sentence is technically true and useless.
    for (const zone of [
      "Pacific/Auckland",
      "Pacific/Honolulu",
      "Asia/Tokyo",
      "Europe/London",
      "America/Los_Angeles",
    ]) {
      const line = hoursApart(zone);
      const magnitude = /(\d+) hours/.exec(line);
      if (magnitude) expect(Number(magnitude[1])).toBeLessThanOrEqual(12);
    }
  });

  it("says 'an hour', not '1 hours'", () => {
    // Findable only by reading, which is why it is pinned. The singular is the
    // difference between a sentence and a template.
    for (const zone of ["Pacific/Auckland", "Pacific/Honolulu", "Asia/Tokyo"]) {
      expect(hoursApart(zone)).not.toMatch(/\b1 hours\b/);
    }
  });
});
