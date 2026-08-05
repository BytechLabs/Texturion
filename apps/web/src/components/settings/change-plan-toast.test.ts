/**
 * #523 — what an upgrade says once it lands.
 *
 * Pro's bigger allowance reinstates held numbers, and the server reports which.
 * The owner pressed Upgrade because a line was dead, so a generic "You're on
 * Pro" leaves them to go and check whether the thing they paid to fix is fixed.
 */
import { describe, expect, it } from "vitest";

import { upgradeToast } from "./change-plan-dialog";

describe("upgradeToast", () => {
  it("keeps the ordinary sentence when nothing was on hold", () => {
    // Almost every upgrade. A reader with no held numbers must never be told
    // anything about holds — that is how a rare-state feature becomes noise on
    // the common path.
    expect(upgradeToast([])).toBe("You're on Pro. The extra allowance starts now.");
  });

  it("names the one number that came back", () => {
    expect(upgradeToast([{ number_e164: "+14155550102" }])).toBe(
      "You're on Pro, and (415) 555-0102 is back.",
    );
  });

  it("counts them past one, rather than listing a toast full of digits", () => {
    expect(
      upgradeToast([
        { number_e164: "+14155550102" },
        { number_e164: "+14155550103" },
      ]),
    ).toBe("You're on Pro, and 2 numbers are back.");
  });

  it("still reports a reinstatement whose number it cannot name", () => {
    // A row with no E.164 is still a line that came back. Falling through to
    // the count keeps the claim true rather than printing "null is back".
    const text = upgradeToast([{ number_e164: null }]);
    expect(text).toContain("You're on Pro");
    expect(text).not.toContain("null");
  });
});
