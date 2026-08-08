/**
 * @vitest-environment happy-dom
 *
 * #523 — the control that gives a number up, and the paragraph it opens.
 *
 * THIS FILE EXISTS BECAUSE NOTHING ASSERTED THE CONTROL RENDERS AT ALL. A
 * verifier deleted the whole owner block from `NumberCard` and 1953 tests
 * passed. Release is the one action on this screen a customer cannot take back
 * and the only way to stop paying rent on a line they no longer want; it had
 * less coverage than the copy button beside it.
 *
 * WHAT IS PINNED. The gate (`mayReleaseNumber` plus `workspace.own`) has its own
 * unit suite; what cannot be checked there is whether the component still asks
 * it, and whether pressing the button produces the words that go with the state.
 * So these render, and the copy ones click. Asserting the paragraph through
 * `releaseNumberBody` rather than as a literal keeps the catalogue the source of
 * truth instead of making this file a ceiling on editing it — except for the one
 * clause the defect is about, which is named outright.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NumberHoldState } from "./number-hold";
import type { NumberStatus, PhoneNumberSummary } from "@/lib/api/types";

const state = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The release mutation is the only hook this card owns. Everything else it
// mounts is a sibling dialog with its own suite and its own query surface —
// stubbed so a test about ONE control does not drag four unrelated ones in.
/**
 * #537 audit: the confirmation gate reaches for the code-request mutation, which
 * needs a QueryClient. Stubbed rather than provided, because these render a card and
 * assert its words — the gate has its own tests.
 */
vi.mock("@/lib/api/ownership", () => ({
  useRequestHandoverCode: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/api/numbers", () => ({
  useReleaseNumber: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/components/settings/number-access-dialog", () => ({
  NumberAccessDialog: () => null,
}));
vi.mock("@/components/settings/number-identity-dialog", () => ({
  NumberIdentityDialog: () => null,
}));
vi.mock("@/components/settings/number-hours-dialog", () => ({
  NumberHoursDialog: () => null,
}));
vi.mock("@/components/settings/choose-number-dialog", () => ({
  ChooseNumberDialog: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { NumberCard } from "./number-card";
import { releaseNumberBody } from "./release-number";

function numberRow(
  status: NumberStatus,
  numberE164: string | null = "+14155550142",
): PhoneNumberSummary {
  return {
    id: "n1",
    status,
    country: "US",
    number_e164: numberE164,
    requested_area_code: null,
    created_at: "2026-07-01T00:00:00Z",
    source: "provisioned",
  } as unknown as PhoneNumberSummary;
}

function show(args: {
  status: NumberStatus;
  numberE164?: string | null;
  subscriptionActive?: boolean;
  hold?: NumberHoldState | null;
  role?: string;
}) {
  state.role = args.role ?? "owner";
  render(
    <NumberCard
      number={numberRow(
        args.status,
        args.numberE164 === undefined ? "+14155550142" : args.numberE164,
      )}
      hold={args.hold}
      subscriptionActive={args.subscriptionActive ?? true}
    />,
  );
}

/** The control itself, or null. */
function releaseControl(): HTMLElement | null {
  return screen.queryByRole("button", { name: /Release this number/ });
}

afterEach(cleanup);
beforeEach(() => {
  state.role = "owner";
});

describe("NumberCard offers Release — the guard that did not exist", () => {
  it("renders it for an owner on a working number", () => {
    // The base case. Deleting the owner block used to break nothing.
    show({ status: "active" });
    expect(releaseControl()).not.toBeNull();
  });

  it("renders it for an owner on a HELD number — D6", () => {
    // The whole point of the #523 change: a held line an owner cannot use and
    // cannot end is a line they pay rent on forever.
    show({
      status: "suspended",
      hold: { kind: "over_allowance", allowance: 1 },
    });
    expect(releaseControl()).not.toBeNull();
  });

  it("withholds it while the payment is the problem", () => {
    // A past-due workspace has EVERY number suspended; the fix is the card, and
    // an irreversible button in front of somebody in that state is a press made
    // in a panic.
    show({
      status: "suspended",
      subscriptionActive: false,
      hold: { kind: "subscription_inactive" },
    });
    expect(releaseControl()).toBeNull();
  });

  it("withholds it from a number that has already gone", () => {
    show({ status: "released" });
    expect(releaseControl()).toBeNull();
  });

  it("withholds it from a row with no digits to type back", () => {
    show({ status: "provisioning", numberE164: null });
    expect(releaseControl()).toBeNull();
  });

  it("offers it to the owner only", () => {
    // `workspace.own` — the same capability `DELETE /v1/numbers/:id` requires.
    // An admin manages numbers all day and still may not end one.
    for (const role of ["admin", "member"]) {
      cleanup();
      show({ status: "active", role });
      expect(releaseControl(), role).toBeNull();
    }
  });

  it("does not fall back to offering it when nobody said the plan is live", () => {
    // `subscriptionActive` defaults FALSE, so a caller that has not been taught
    // the rule withholds the control on a held line rather than offering one it
    // should not. A working number is unaffected, which is every ordinary card.
    render(
      <NumberCard
        number={numberRow("suspended")}
        hold={{ kind: "over_allowance", allowance: 1 }}
      />,
    );
    expect(releaseControl()).toBeNull();
  });
});

describe("…and the confirmation describes the number in front of you", () => {
  it("does not promise a free replacement to somebody on hold — C3", () => {
    // The defect. A workspace is on hold BECAUSE the included number is already
    // in use, so releasing brings it back TO the allowance and no further:
    // believing this sentence costs a paid extra, or a refusal at the Starter
    // cap after the number is already gone.
    const hold: NumberHoldState = { kind: "over_allowance", allowance: 1 };
    show({ status: "suspended", hold });

    fireEvent.click(releaseControl() as HTMLElement);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(releaseNumberBody(hold));
    expect(dialog.textContent).not.toContain(
      "you can set up a new one here afterward",
    );
  });

  it("keeps that promise where it is true", () => {
    // The other direction, and the common one: an ordinary working number, no
    // hold, plan-included replacement available.
    show({ status: "active" });

    fireEvent.click(releaseControl() as HTMLElement);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(releaseNumberBody(null));
    expect(dialog.textContent).toContain(
      "you can set up a new one here afterward",
    );
  });

  it("still makes the owner type the number", () => {
    // The pause in front of the irreversible thing (G8). The branched paragraph
    // above is the reason to use it; this is the friction itself.
    show({ status: "active" });
    fireEvent.click(releaseControl() as HTMLElement);

    const confirm = screen.getByRole("button", { name: "Release number" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
});
