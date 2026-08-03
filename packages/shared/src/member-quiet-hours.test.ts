import { describe, expect, it } from "vitest";

import { isMemberQuietNow } from "./member-quiet-hours";

const TORONTO = "America/Toronto";
/** 02:00 Toronto (06:00Z in August). */
const NIGHT = new Date("2026-08-05T06:00:00Z");
/** 14:00 Toronto. */
const AFTERNOON = new Date("2026-08-05T18:00:00Z");
/** 07:00 Toronto exactly. */
const SEVEN_AM = new Date("2026-08-05T11:00:00Z");
/** 22:00 Toronto exactly. */
const TEN_PM = new Date("2026-08-06T02:00:00Z");

const OVERNIGHT = { from: "22:00", to: "07:00", timezone: TORONTO };

describe("isMemberQuietNow", () => {
  it("MQ-1: an overnight window wraps past midnight", () => {
    // The only shape anybody actually sets, and the one a naive
    // `from <= now < to` gets exactly backwards — it would be quiet all DAY
    // and noisy all night.
    expect(isMemberQuietNow(OVERNIGHT, null, NIGHT)).toBe(true);
    expect(isMemberQuietNow(OVERNIGHT, null, AFTERNOON)).toBe(false);
  });

  it("MQ-2: half-open, so the window ends when it says it does", () => {
    // 07:00 is when they wake up. A phone still silent at 07:00 is a phone
    // that missed the first job of the day.
    expect(isMemberQuietNow(OVERNIGHT, null, SEVEN_AM)).toBe(false);
    expect(isMemberQuietNow(OVERNIGHT, null, TEN_PM)).toBe(true);
  });

  it("MQ-3: no window means no suppression, which is every existing member", () => {
    expect(
      isMemberQuietNow({ from: null, to: null, timezone: null }, TORONTO, NIGHT),
    ).toBe(false);
    // Half a window is not a window — the DB refuses it, and if one ever
    // arrives we notify rather than silence.
    expect(
      isMemberQuietNow({ from: "22:00", to: null, timezone: TORONTO }, null, NIGHT),
    ).toBe(false);
  });

  it("MQ-4: falls back to the company's clock when the member has no zone", () => {
    // The common case: a crew all in one place, nobody having set a personal
    // timezone.
    expect(
      isMemberQuietNow({ from: "22:00", to: "07:00", timezone: null }, TORONTO, NIGHT),
    ).toBe(true);
  });

  it("MQ-5: every uncertainty NOTIFIES, unlike #225 which withholds", () => {
    // A wrong guess here buzzes a phone somebody wanted quiet. A wrong guess
    // the other way silently withholds a message they were waiting for, and
    // they would never know it happened.
    const nonsense = { from: "not a time", to: "07:00", timezone: TORONTO };
    expect(isMemberQuietNow(nonsense, null, NIGHT)).toBe(false);

    const badZone = { from: "22:00", to: "07:00", timezone: "Mars/Olympus" };
    expect(isMemberQuietNow(badZone, null, NIGHT)).toBe(false);

    expect(isMemberQuietNow(OVERNIGHT, null, NIGHT)).toBe(true); // control
  });

  it("MQ-6: a zero-length window silences nothing", () => {
    // 22:00-22:00 is a typo, not "always quiet". Reading it the other way
    // silences a phone permanently and nobody would connect the two.
    expect(
      isMemberQuietNow({ from: "22:00", to: "22:00", timezone: TORONTO }, null, NIGHT),
    ).toBe(false);
  });

  it("MQ-7: a same-day window works too, for the night-shift crews", () => {
    // Somebody who sleeps 09:00-16:00 is not exotic in a trade that runs
    // 24-hour callouts.
    const daytime = { from: "09:00", to: "16:00", timezone: TORONTO };
    expect(isMemberQuietNow(daytime, null, AFTERNOON)).toBe(true);
    expect(isMemberQuietNow(daytime, null, NIGHT)).toBe(false);
  });
});
