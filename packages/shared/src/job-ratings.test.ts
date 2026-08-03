/**
 * #313 — reading a rating out of a text message.
 *
 * The parser is the whole risk surface here, and it fails in one direction that
 * matters: too loose, and a real message is silently eaten as a score. A
 * customer writing "4 more days until the wedding, thanks!" has not rated
 * anything, and a business that treats it as a 4 has both lost the message and
 * gained a wrong number.
 */
import { describe, expect, it } from "vitest";

import {
  isPoorRating,
  parseRatingReply,
  RATING_POOR_AT_OR_BELOW,
} from "./job-ratings";

describe("#313 parseRatingReply", () => {
  it("reads the shapes a person actually thumbs", () => {
    for (const [body, expected] of [
      ["5", 5],
      [" 4 ", 4],
      ["3.", 3],
      ["2!", 2],
      ["1", 1],
      ["5/5", 5],
      ["4 / 5", 4],
    ] as const) {
      expect(parseRatingReply(body), body).toBe(expected);
    }
  });

  it("refuses a sentence that merely contains a digit", () => {
    // Each of these is a real message. Eating one loses it AND records a score
    // nobody gave.
    for (const body of [
      "4 more days until the wedding, thanks!",
      "5 stars mate",
      "about a 4 I'd say",
      "call me on 5551234",
      "can you come back on the 3rd",
    ]) {
      expect(parseRatingReply(body), body).toBeNull();
    }
  });

  it("refuses a number off this scale", () => {
    // "10/10" is a compliment, not a 10 — and not a 1 either, which is what a
    // lazier parser reading the first digit would record.
    for (const body of ["0", "6", "10", "10/10", "-1"]) {
      expect(parseRatingReply(body), body).toBeNull();
    }
  });

  it("refuses an empty or wordless reply", () => {
    for (const body of ["", "   ", "👍", "?"]) {
      expect(parseRatingReply(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("#313 isPoorRating", () => {
  it("wakes somebody for 1 and 2, and not for 3", () => {
    // 3 out of 5 is "fine" — mildly disappointing at worst. Alerting on it is
    // how the alert becomes noise and the genuine 1s get skimmed past.
    expect(isPoorRating(1)).toBe(true);
    expect(isPoorRating(2)).toBe(true);
    expect(isPoorRating(3)).toBe(false);
    expect(isPoorRating(5)).toBe(false);
  });

  it("agrees with the constant it is derived from", () => {
    // A guard against the two drifting: the threshold is quoted in the ask
    // copy's reasoning and in the escalation path, and a function that stopped
    // matching it would escalate a different set than the docs describe.
    expect(isPoorRating(RATING_POOR_AT_OR_BELOW)).toBe(true);
    expect(isPoorRating(RATING_POOR_AT_OR_BELOW + 1)).toBe(false);
  });
});
