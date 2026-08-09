/**
 * @vitest-environment happy-dom
 */
/**
 * #583 — the change-plan dialog states the credit BEFORE the switch, and refuses to
 * act until somebody has read it.
 *
 * The order is the whole point. Until this shipped, a customer inside a prepaid year
 * pressed Upgrade and got a 409 back: a refusal, arriving after the act, reading as
 * "you cannot" — to the one customer who both can and wants to pay us more. The
 * arithmetic has to be on screen first.
 *
 * Three properties are load-bearing and all three are asserted rather than described:
 *
 *   1. **The figures come from the server.** Every amount in the fixture is one no
 *      constant in the price book produces, so rendering them is only possible by
 *      having read the response. A hardcoded "$217.50" would pass a laxer test.
 *   2. **The consent cannot be skipped.** The switch is unavailable until the tick,
 *      and the mutation carries the flag the server demands.
 *   3. **The copy says CREDIT and an amount, never "free months".** Stripe applies a
 *      credit balance to the whole invoice, so an overage-heavy month can spend it
 *      instead of the plan fee; "two months free" is a promise the mechanism cannot
 *      keep. D131 settles the design in money rather than months, and that is only
 *      honest if the words match — so the words are pinned.
 *
 * The dialog is DRIVEN rather than server-rendered: its content lives in a portal
 * that does not exist until the trigger is clicked, so a static render would assert
 * against a button and nothing else. That is how the first version of this file
 * passed three tests while proving nothing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrepayOffer } from "@/lib/api/billing";
import type { CompanyView } from "@/lib/api/types";

const offer = vi.hoisted(() => ({ data: undefined as PrepayOffer | undefined }));
const changePlan = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/lib/api/billing", () => ({
  usePrepayOffer: () => offer,
  useChangePlan: () => changePlan,
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { members: [] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const { ChangePlanDialog } = await import("./change-plan-dialog");

/**
 * A Starter workspace with a prepaid year four months in.
 *
 * The amounts are deliberately NOT the real ones. $290 over twelve months would let
 * a hardcoded "$217.50" pass; $312 collected with $221 owed back is a pair that no
 * plan price, no amortisation of a catalog figure, and no rounding of one produces.
 * The two differ from each other as well, so reading the wrong field is visible
 * rather than plausible.
 */
const PREPAID: PrepayOffer = {
  eligible: false,
  reason: "already_prepaid",
  price_cents: null,
  monthly_cents: null,
  currency: "usd",
  months: 12,
  open: {
    plan: "starter",
    amount_cents: 31_200,
    currency: "usd",
    granted_through: "2027-03-01T00:00:00.000Z",
    conversion: { consumed_months: 4, credit_cents: 22_100 },
  },
};

const company = {
  id: "c1",
  plan: "starter",
  billing_currency: "usd",
} as unknown as CompanyView;

/**
 * Mount the dialog and open it, which is the only state worth asserting on.
 *
 * NO DEFAULT PARAMETER. `openDialog(undefined)` — the "the read has not landed" case
 * — would take a default and silently render the full fixture instead, which is
 * exactly what happened: the test asserting that nothing is shown was shown
 * everything, and said so only because three elements matched instead of one.
 */
function openDialog(data: PrepayOffer | undefined) {
  offer.data = data;
  render(<ChangePlanDialog company={company} />);
  fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
}

/** The confirm control inside the open dialog, not the trigger that opened it. */
function switchButton(): HTMLButtonElement {
  const all = screen.getAllByRole("button", { name: "Upgrade to Pro" });
  return all[all.length - 1] as HTMLButtonElement;
}

beforeEach(() => {
  changePlan.mutate.mockReset();
});
afterEach(() => {
  cleanup();
  // Radix renders dialog content into a portal appended to `document.body`, which
  // is OUTSIDE the container testing-library's `cleanup` owns — so it survives, and
  // the next test's queries see two dialogs. It made a "renders nothing" assertion
  // fail for the right reason and could just as easily have made one pass for the
  // wrong one.
  document.body.innerHTML = "";
});

describe("#583 who sees anything about a prepaid year", () => {
  it("nobody who never prepaid, which is almost everybody", () => {
    // A panel for a rare state must not become furniture on the common one — the
    // same rule this file already applies to reinstated numbers in `upgradeToast`.
    openDialog({ ...PREPAID, open: null });
    expect(screen.queryByText(/prepaid/i)).toBeNull();
    expect(switchButton().disabled).toBe(false);
  });

  it("nobody, while the answer has not landed yet", () => {
    // A dialog that flashed "no prepaid year" and then contradicted itself would be
    // worse than one that says nothing until it knows.
    openDialog(undefined);
    expect(screen.queryByText(/prepaid/i)).toBeNull();
  });
});

describe("#583 what the panel says", () => {
  it("states what was paid, what is used, and what comes back", () => {
    openDialog(PREPAID);
    // $312.00 collected, four months in, $221.00 back. None of the three is
    // derivable from the price book, so printing them requires having read them.
    expect(screen.getByText("$312")).toBeTruthy();
    expect(screen.getByText("$221")).toBeTruthy();
    expect(screen.getByText("4 of 12")).toBeTruthy();
  });

  it("says credit and an amount, and never promises months of service", () => {
    openDialog(PREPAID);
    expect(
      screen.getByText(/puts \$221 back on your account as credit/),
    ).toBeTruthy();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/months? free/i);
    expect(html).not.toMatch(/free months?/i);
  });

  it("names the plan whose normal price they will start paying", () => {
    openDialog(PREPAID);
    expect(screen.getByText(/normal Pro monthly price/)).toBeTruthy();
  });
});

describe("#583 consent", () => {
  it("will not switch until the acknowledgement is ticked", () => {
    openDialog(PREPAID);
    expect(switchButton().disabled).toBe(true);
    fireEvent.click(switchButton());
    expect(changePlan.mutate).not.toHaveBeenCalled();
  });

  it("puts the amount in the acknowledgement itself", () => {
    // "End my prepaid year" alone asks somebody to agree to a number they have to go
    // back up the dialog to find. The tick carries the figure it agrees to.
    openDialog(PREPAID);
    expect(screen.getByText("End my prepaid year and credit me $221")).toBeTruthy();
  });

  it("sends the flag the server demands once it is ticked", () => {
    openDialog(PREPAID);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(switchButton().disabled).toBe(false);
    fireEvent.click(switchButton());
    expect(changePlan.mutate).toHaveBeenCalledWith(
      { plan: "pro", convertPrepaid: true },
      expect.anything(),
    );
  });

  it("does not send the flag for a workspace with no prepaid year", () => {
    // The flag is meaningless there, and a client that sent it unconditionally
    // would be asserting consent nobody was asked for.
    openDialog({ ...PREPAID, open: null });
    fireEvent.click(switchButton());
    expect(changePlan.mutate).toHaveBeenCalledWith(
      { plan: "pro", convertPrepaid: false },
      expect.anything(),
    );
  });

  it("forgets the tick when the dialog is closed", () => {
    // A tick left over from a conversation somebody walked away from is not consent.
    openDialog(PREPAID);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(switchButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Never mind" }));
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));

    expect(switchButton().disabled).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
