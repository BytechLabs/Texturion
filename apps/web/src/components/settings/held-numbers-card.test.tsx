/**
 * #523 — the card an owner meets after coming back on a smaller plan.
 *
 * The rendering RULES are the subject here, not the markup. This card sits on a
 * billing screen belonging to somebody who has just chosen to return, and every
 * assertion below is about not making that moment worse: not appearing when the
 * win-back card owns the state, not quoting a price we invented, not offering a
 * button that 409s, and never leaving a dead number with no stated way back.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { HeldNumbersView } from "@/lib/api/billing";

const held = vi.hoisted(() => ({
  data: undefined as HeldNumbersView | undefined,
}));

vi.mock("@/lib/api/billing", () => ({
  useHeldNumbers: () => held,
  useReinstateHeldNumber: () => ({ isPending: false, mutate: vi.fn() }),
}));

const { HeldNumbersCard, holdRoutes, showsHold } = await import(
  "./held-numbers-card"
);

function view(over: Partial<HeldNumbersView> = {}): HeldNumbersView {
  return {
    plan: "starter",
    included: 1,
    paid_extras: 0,
    allowance: 1,
    max_total: 2,
    reason: "over_plan_allowance",
    held: [
      { id: "n2", number_e164: "+14155550102", suspended_at: "2026-08-04T10:00:00Z" },
    ],
    extra_number_cents: 500,
    extra_number_currency: "usd",
    can_reinstate: true,
    can_upgrade: true,
    ...over,
  };
}

function render(data: HeldNumbersView | undefined, show = true): string {
  held.data = data;
  return renderToStaticMarkup(<HeldNumbersCard show={show} />);
}

describe("HeldNumbersCard", () => {
  it("names the held number, the allowance, and the price to bring it back", () => {
    const html = render(view());
    expect(html).toContain("(415) 555-0102");
    expect(html).toContain("covers 1 number");
    expect(html).toContain("$5");
  });

  it("quotes the SERVER's price and currency, never a local price book", () => {
    // #522 was exactly this: a client rendering "$5" out of its own head on a
    // workspace billed in CAD. Both halves come off the response.
    const html = render(
      view({ extra_number_cents: 700, extra_number_currency: "cad" }),
    );
    expect(html).toContain("$7");
    expect(html).not.toContain("$5");
  });

  it("renders NOTHING during the grace window", () => {
    // A cancelled workspace's numbers are suspended for a different reason and
    // the win-back card owns that state. "Buy your number back" aimed at
    // somebody who has just stopped paying is the wrong screen entirely.
    expect(render(view({ reason: "subscription_inactive" }))).toBe("");
  });

  it("renders nothing when nothing is held, and nothing before the answer lands", () => {
    expect(render(view({ reason: null, held: [] }))).toBe("");
    expect(render(undefined)).toBe("");
  });

  it("renders nothing for a reader who cannot manage billing", () => {
    expect(render(view(), false)).toBe("");
  });

  it("hides the buy button when the server says the purchase would be refused", () => {
    // Starter already at its hard cap. The remaining route is named instead —
    // a button whose only outcome is a 409 is how somebody decides the product
    // is broken.
    const html = render(view({ can_reinstate: false, can_upgrade: true }));
    expect(html).not.toContain("Bring it back");
    expect(html).toContain("Moving to Pro");
  });

  it("never leaves a held number with no stated way back", () => {
    // Both routes closed — a paused plan, or an unprovisioned catalog. Rare,
    // and the one outcome this card must never produce is a dead number and
    // silence.
    const html = render(view({ can_reinstate: false, can_upgrade: false }));
    expect(html).toContain("get in touch");
  });

  it("states the plan's hard cap before somebody buys into it", () => {
    const html = render(view({ max_total: 2 }));
    expect(html).toContain("tops out at 2 numbers");
  });

  it("does not quote a cap that does not exist", () => {
    // Pro is uncapped; `max_total` is null and the sentence must be absent
    // rather than rendered with an empty hole in it.
    const html = render(
      view({ plan: "pro", max_total: null, can_upgrade: false, allowance: 2 }),
    );
    expect(html).not.toContain("tops out");
    expect(html).not.toContain("null");
  });

  it("speaks about one number in the singular and several in the plural", () => {
    const one = render(view());
    expect(one).toContain("One number is on hold");
    expect(one).toContain("this one is on hold");

    const two = render(
      view({
        allowance: 1,
        held: [
          { id: "a", number_e164: "+14155550102", suspended_at: null },
          { id: "b", number_e164: "+14155550103", suspended_at: null },
        ],
      }),
    );
    expect(two).toContain("Numbers on hold");
    expect(two).toContain("these are on hold");
  });

  it("says the number is NOT gone, and never dramatises the hold", () => {
    // The reader has just chosen to come back. The facts do the work: a hold
    // is reversible and nothing was given up, and a screen that implies
    // otherwise is arguing against the decision they just made.
    const html = render(view());
    expect(html).toContain("Nothing has been given up");
    expect(html).toContain("texts and calls still come through");
    const lower = html.toLowerCase();
    for (const word of ["lost", "expired", "deleted", "released", "urgent"]) {
      expect(lower).not.toContain(word);
    }
  });

  it("renders no apostrophe entities as literal text", () => {
    // A `&apos;` inside a JS string literal is not decoded by JSX — it prints
    // as five characters in the middle of a sentence.
    expect(render(view())).not.toContain("&amp;apos;");
  });
});

describe("showsHold / holdRoutes", () => {
  it("shows only for an over-allowance hold with something in it", () => {
    expect(showsHold(view())).toBe(true);
    expect(showsHold(view({ reason: "subscription_inactive" }))).toBe(false);
    expect(showsHold(view({ held: [] }))).toBe(false);
    expect(showsHold(undefined)).toBe(false);
  });

  it("reports the case nobody pictures: both routes closed", () => {
    expect(holdRoutes(view({ can_reinstate: false, can_upgrade: false }))).toEqual(
      { canBuy: false, canUpgrade: false },
    );
  });
});
