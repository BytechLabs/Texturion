/**
 * #354 — the pipeline panel's one piece of local arithmetic.
 *
 * Everything else on the card is computed server-side on purpose: a win rate
 * computed twice is a win rate that can disagree with itself, and this one is a
 * claim about the customer's own business.
 */
import { describe, expect, it } from "vitest";

import { rateDelta } from "./pipeline-card";

describe("#354 rateDelta", () => {
  it("reports the move in points", () => {
    expect(rateDelta(75, 60)).toBe(15);
    expect(rateDelta(60, 75)).toBe(-15);
  });

  it("says nothing rather than zero when a side is missing", () => {
    // "Unchanged" and "we do not know yet" are different facts, and only one of
    // them is reassuring. A workspace with no previous period must not be shown
    // a flat arrow implying it has held steady.
    expect(rateDelta(75, null)).toBeNull();
    expect(rateDelta(null, 60)).toBeNull();
    expect(rateDelta(null, null)).toBeNull();
  });

  it("distinguishes a genuine no-change from an unknown", () => {
    expect(rateDelta(75, 75)).toBe(0);
  });
});
