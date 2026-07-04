/**
 * Review-ask confirm dialog copy (FEATURE-GAPS Step 0b / §3): the API's one
 * 409 code covers quiet hours AND cold threads — this helper picks which
 * framing the dialog shows, mirroring the API's destination-clock check.
 */
import { describe, expect, it } from "vitest";

import { reviewConfirmCopy } from "./review-confirm";

// Same clock fixtures as the API suites: +1613 = America/Toronto.
// 2026-07-01T16:00Z → 12:00 local; 2026-07-01T03:00Z → 23:00 local (June 30).
const OTTAWA = "+16135551000";
const DAYTIME = new Date("2026-07-01T16:00:00.000Z");
const NIGHTTIME = new Date("2026-07-01T03:00:00.000Z");

describe("reviewConfirmCopy", () => {
  it("uses the quiet-hours framing with the destination local time at night", () => {
    const copy = reviewConfirmCopy(OTTAWA, NIGHTTIME);
    expect(copy.title).toBe("It's 11:00 PM for this customer.");
    expect(copy.description).toBe("Send the review ask anyway?");
  });

  it("uses the cold-thread framing during the destination's daytime", () => {
    const copy = reviewConfirmCopy(OTTAWA, DAYTIME);
    expect(copy.title).toBe("This thread has gone quiet.");
    expect(copy.description).toContain("fresh conversation");
  });

  it("covers the quiet window edges (20:00 quiet, 08:00 not)", () => {
    // 2026-07-02T00:30Z → 20:30 in Toronto (quiet); 12:30Z → 08:30 (not).
    expect(
      reviewConfirmCopy(OTTAWA, new Date("2026-07-02T00:30:00.000Z")).title,
    ).toContain("for this customer");
    expect(
      reviewConfirmCopy(OTTAWA, new Date("2026-07-02T12:30:00.000Z")).title,
    ).toBe("This thread has gone quiet.");
  });

  it("falls back to the cold-thread framing for non-geographic codes", () => {
    // +1710 is non-geographic: the API never quiet-gates it (unknown local
    // hour), so a 409 for this number can only be the recency branch.
    const copy = reviewConfirmCopy("+17105550123", NIGHTTIME);
    expect(copy.title).toBe("This thread has gone quiet.");
  });
});
