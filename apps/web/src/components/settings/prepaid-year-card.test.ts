/**
 * #400 / D107 — the numbers the prepaid-year card puts in front of a paying
 * customer.
 *
 * The framing is the whole persuasion, so it has to be arithmetic rather than
 * marketing. An earlier design for this feature claimed "ten months' money for
 * twelve" while actually delivering ten months of service, which is exactly the
 * class of error a test on the numbers catches and a test on the markup does
 * not.
 *
 * #522 moved the monthly figure out of a USD price book and into the same
 * server response the price comes from, so these cases now pass both amounts
 * in. The currency never appears here on purpose: two amounts in one currency
 * subtract correctly whatever that currency is, and the test that the RENDERED
 * card puts them in front of the right reader lives in
 * `prepaid-year-card.render.test.tsx`.
 */
import { describe, expect, it } from "vitest";

import { prepaidYearFraming } from "./prepaid-year-card";

describe("#400 prepaidYearFraming", () => {
  it("compares against twelve real monthly payments", () => {
    // $29/mo x 12 = $348. The saving is what the customer actually keeps.
    const f = prepaidYearFraming(29_000, 2_900);
    expect(f.twelveMonthsCents).toBe(34_800);
    expect(f.savingCents).toBe(5_800);
  });

  it("prices Pro from the Pro monthly figure, not the Starter one", () => {
    const f = prepaidYearFraming(79_000, 7_900);
    expect(f.twelveMonthsCents).toBe(94_800);
    expect(f.savingCents).toBe(15_800);
  });

  it("divides by 365, because the daily figure has to be true", () => {
    // #400 asks for the daily frame as the most favourable HONEST comparison
    // available. Dividing by 360 to round it down to a nicer number would make
    // it neither.
    expect(prepaidYearFraming(29_000, 2_900).perDayCents).toBe(79);
    expect(prepaidYearFraming(79_000, 7_900).perDayCents).toBe(216);
  });

  it("never shows a negative saving", () => {
    // A year priced at or above twelve months is not an offer. If the catalog
    // ever drifts that way the card must not render "saved -$52" — it shows
    // nothing saved, and the number beside it makes the case on its own.
    const f = prepaidYearFraming(40_000, 2_900);
    expect(f.savingCents).toBe(0);
  });

  it("uses the price the SERVER quoted, so a promo code stays honest", () => {
    // The card is handed `price_cents` from the API rather than a constant, so
    // a discounted session shows the discounted saving rather than the list
    // one. Anything else would quote a number the customer is not being
    // charged.
    const f = prepaidYearFraming(24_650, 2_900);
    expect(f.savingCents).toBe(34_800 - 24_650);
    expect(f.perDayCents).toBe(68);
  });

  it("#522: subtracts a CAD year from CAD months, and the offer survives", () => {
    // THIS IS THE CASE THAT WAS BROKEN. CA$390 against the USD book's $348
    // clamped to `savingCents: 0`, so the card told a Canadian owner their year
    // saved them nothing — while charging them for it. Against the real CA$39
    // monthly it is the same ten-for-twelve deal the US customer gets.
    const f = prepaidYearFraming(39_000, 3_900);
    expect(f.twelveMonthsCents).toBe(46_800);
    expect(f.savingCents).toBe(7_800);
  });
});
