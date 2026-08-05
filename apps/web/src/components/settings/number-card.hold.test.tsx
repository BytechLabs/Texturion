/**
 * #523 — what a suspended number tells its owner.
 *
 * This is the honesty defect the issue exposed on web. The card had ONE
 * sentence for a suspended number — "Update your payment method" — written when
 * a lapsed card was the only way to get one. Against a #523 hold that sentence
 * is false in the most expensive way available: the payment went through, the
 * card is fine, and it sends somebody to a Stripe portal to fix nothing while
 * the real reason goes unsaid on the one screen showing the number.
 */
import { canSeeSettingsSection, MEMBER_ROLES } from "@loonext/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PhoneNumberSummary } from "@/lib/api/types";

import type { NumberHoldState } from "./number-hold";

// Rendered as a MEMBER, which is deliberate rather than convenient: the
// explanation sits outside every role gate, so a member exercises exactly the
// same copy without dragging the owner-only access/identity/release dialogs
// (and their whole hook surface) into a test about one sentence. It is also the
// reader the "unknown" branch exists for.
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "member" }),
}));

const { NumberCard } = await import("./number-card");

const suspended = {
  id: "n2",
  status: "suspended",
  country: "US",
  number_e164: "+14155550102",
  requested_area_code: null,
  created_at: "2026-01-01T00:00:00Z",
} as unknown as PhoneNumberSummary;

function render(hold: NumberHoldState | null | undefined): string {
  return renderToStaticMarkup(<NumberCard number={suspended} hold={hold} />);
}

describe("NumberCard — a suspended number's explanation", () => {
  it("explains an allowance hold, and does NOT blame the payment method", () => {
    const html = render({ kind: "over_allowance", allowance: 1 });
    expect(html).toContain("On hold");
    expect(html).toContain("covers 1 number");
    expect(html).toContain("nothing has been given up");
    // The regression this whole file exists for.
    expect(html).not.toContain("Update your payment method");
  });

  it("keeps the payment-method advice for the case it is actually true of", () => {
    const html = render({ kind: "subscription_inactive" });
    expect(html).toContain("Update your payment method");
  });

  it("asserts no cause when it could not find one out", () => {
    // A MEMBER cannot read the billing route at all. Guessing here is what the
    // old copy did, and it guessed wrong.
    const html = render({ kind: "unknown" });
    expect(html).toContain("Texting is paused on this number");
    expect(html).not.toContain("Update your payment method");
    expect(html).not.toContain("On hold");
  });

  it("falls through to the neutral sentence when no hold is resolved at all", () => {
    // A caller that has not been taught the difference must not resurrect the
    // old wrong guess by default.
    expect(render(undefined)).not.toContain("Update your payment method");
    expect(render(null)).toContain("Texting is paused on this number");
  });

  it("survives an allowance the server could not resolve", () => {
    const html = render({ kind: "over_allowance", allowance: null });
    expect(html).toContain("covers fewer numbers than you have");
    expect(html).not.toContain("null");
  });
});

/**
 * #523 — every branch of that sentence ends at Settings › Billing, so the link
 * has to be openable by whoever is reading it.
 *
 * Android and iOS solve this in copy: both show the numbers screen to every
 * role, so both branch on `canManageBilling` and send a plain member to a person
 * ("Ask an owner or admin", "Your account owner can bring it back from
 * Billing") rather than to a screen that will refuse them. Web reaches the same
 * end by a different route — the #515 section gate means only somebody who can
 * open Billing can be looking at this sentence at all.
 *
 * That is a property of the SHARED capability table, not of this component, and
 * it is exactly the kind of thing a new role preset breaks silently: give a
 * dispatcher `numbers.manage` without `billing.manage` and every suspended
 * number on their screen points at a refusal page. Hence a guard rather than a
 * comment.
 */
describe("the billing link is offered only to somebody who can open it", () => {
  it("holds for every role that can reach Settings › Numbers", () => {
    const readers = MEMBER_ROLES.filter((role) =>
      canSeeSettingsSection("numbers", role),
    );
    // A vacuous pass would be the quiet failure here: if nobody can open the
    // numbers screen, the loop below asserts nothing at all.
    expect(readers.length).toBeGreaterThan(0);
    for (const role of readers) {
      expect(canSeeSettingsSection("billing", role), role).toBe(true);
    }
  });

  it("still points at billing, so the guard above is about the real link", () => {
    // Pins the destination the guard is protecting. If the copy ever stops
    // linking to /settings/billing, the capability check above becomes a test
    // of nothing and this one says so.
    for (const hold of [
      { kind: "over_allowance", allowance: 1 },
      { kind: "subscription_inactive" },
      { kind: "unknown" },
    ] satisfies NumberHoldState[]) {
      expect(render(hold)).toContain('href="/settings/billing"');
    }
  });
});
