/**
 * #354 — the pipeline panel's one piece of local arithmetic.
 *
 * Everything else on the card is computed server-side on purpose: a win rate
 * computed twice is a win rate that can disagree with itself, and this one is a
 * claim about the customer's own business.
 */
import { describe, expect, it } from "vitest";

import { rateDelta, showsRate } from "./pipeline-card";

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

describe("#540 showsRate", () => {
  it("withholds the figure whenever the sentence was withheld", () => {
    // `pipelineInsight` says nothing below five decided jobs, on the stated
    // grounds that a rate off two quotes is "noise presented as an
    // achievement". This card printed that rate at 24px beside its own words
    // saying it was too early to call — the panel contradicting itself.
    expect(showsRate(33, null)).toBe(false);
    expect(showsRate(100, null)).toBe(false);
  });

  it("shows it when the server stands behind it", () => {
    // The other half, without which the assertion above passes just as well on
    // a card that never shows a rate at all.
    expect(showsRate(67, "You win 67% of the quotes that get an answer.")).toBe(true);
  });

  it("shows nothing when there is no rate, whatever the sentence says", () => {
    expect(showsRate(null, "anything")).toBe(false);
    expect(showsRate(null, null)).toBe(false);
  });
});
