/**
 * #522 — the figures the prepaid-year card actually puts on screen.
 *
 * `prepaid-year-card.test.ts` beside this proves the arithmetic. This proves
 * the arithmetic is fed from the server response and nothing else, which is the
 * part that was wrong: `price_cents` already moved with the workspace's
 * currency while the monthly it was compared against came from a USD-only
 * price book, so a Canadian owner read a CAD year set against a US year.
 *
 * # Why there is no "renders CAD with a CA$ prefix" case here
 *
 * There would be nothing to assert. `formatMoney` prints a reader's OWN money
 * bare in both currencies — "$417" is what a CAD workspace and a USD workspace
 * each see — so a hardcoded dollar sign produces byte-identical markup and a
 * test on it would pass no matter what this card did. The honest guard is
 * provenance: every figure below is one the fixture supplied, in amounts no
 * plausible hardcode and no entry in the price book reproduces, so the only way
 * to render them is to have read them from the response.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PrepayOffer } from "@/lib/api/billing";

const offer = vi.hoisted(() => ({ data: undefined as PrepayOffer | undefined }));

vi.mock("@/lib/api/billing", () => ({
  usePrepayOffer: () => offer,
  useBuyPrepaidYear: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { PrepaidYearCard } = await import("./prepaid-year-card");

/**
 * A CAD workspace. NONE of these amounts is in the price book: the year is not
 * 29 000/79 000/39 000/109 000 and the monthly is not 2 900/7 900/3 900/10 900,
 * so no constant, no rounding and no plan lookup can produce what this renders.
 * The price and the monthly differ from each other too, so one figure read in
 * place of the other is visible rather than silently plausible.
 */
const CAD: PrepayOffer = {
  eligible: true,
  reason: null,
  price_cents: 41_700,
  monthly_cents: 4_450,
  currency: "cad",
  months: 10,
  open: null,
};

/** Overrides on top of CAD; `null` is "the read has not landed". */
function render(data: Partial<PrepayOffer> | null = {}, show = true): string {
  offer.data = data === null ? undefined : { ...CAD, ...data };
  return renderToStaticMarkup(<PrepaidYearCard show={show} />);
}

describe("#522 PrepaidYearCard figures", () => {
  it("compares the year against the monthly the SERVER sent, in one currency", () => {
    const html = render();
    // 4 450 x 12 = 53 400, and 53 400 - 41 700 = 11 700. Both fall out of the
    // response. Reading the monthly from the USD book instead would print
    // "$348" here and clamp the saving to "$0" — the card arguing against its
    // own offer, on a Canadian workspace, which is the shipped defect.
    expect(html).toContain("$417 for 10 months");
    expect(html).toContain("instead of $534");
    expect(html).toContain("$117 saved");
    expect(html).not.toContain("$348");
    expect(html).not.toContain("$0 saved");
  });

  it("divides the real price by 365 for the daily frame", () => {
    // 41 700 / 365 = 114.2. The anchor has to be the price the reader is
    // actually about to pay, or it is a marketing number.
    expect(render()).toContain("114¢ a day");
  });

  it("names the exact amount on the button that authorises it", () => {
    // Contrast & Anchoring earns the daily figure; consent is earned by the
    // total. The control someone presses says what pressing it costs.
    expect(render()).toContain("Pay $417");
  });

  it("renders nothing when there is no monthly to compare against", () => {
    // The persuasion IS the comparison. An offer to hand over a year of money
    // with nothing to weigh it against is not one to make, and a shorter card
    // for a shape that cannot occur is a second layout nobody will maintain.
    expect(render({ monthly_cents: null })).toBe("");
  });

  it("renders nothing on a refusal, figure or no figure", () => {
    // `currency_unavailable` arrives with `price_cents: null` precisely so no
    // surface can render the offer greyed out with the wrong money on it.
    expect(render({ eligible: false, price_cents: null })).toBe("");
    expect(render({ eligible: false, reason: "currency_unavailable" })).toBe("");
  });

  it("never relabels a year that was collected in another currency", () => {
    // A year bought before the CAD option was filed was genuinely charged in
    // US dollars, and this workspace is CAD today. The open-year card states
    // the DATE and no amount — printing 28 900 here with the workspace's
    // current currency would tell somebody they paid CA$289 when Stripe took
    // US$289. The date is the useful fact; the amount is on their receipt.
    const html = render({
      open: {
        plan: "starter",
        amount_cents: 28_900,
        currency: "usd",
        granted_through: "2027-03-04T00:00:00.000Z",
        // #583: this card states the date and no amount, so the conversion
        // figures are irrelevant to it — present because the shape requires it,
        // and null because a row written before #583 has none.
        conversion: null,
      },
    });
    expect(html).toContain("covered until");
    expect(html).not.toContain("289");
  });

  it("renders nothing while the answer is still unknown", () => {
    // No skeleton and no error box: a billing page showing a broken panel
    // where a price should be looks like the billing itself is broken.
    expect(render(null)).toBe("");
    expect(render({}, false)).toBe("");
  });
});
