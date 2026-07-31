/**
 * #481 — the opt-in surface for a departing crew.
 *
 * The copy is the feature and the deadline is the copy: an owner who believes
 * this outlives their account has been misled by us at the worst possible
 * moment. So most of what is pinned here is what the screen must say, and what
 * it must never do on its own.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  company: {
    data: undefined as
      | {
          subscription_status: string;
          canceled_at: string | null;
          offramp_message?: string | null;
        }
      | undefined,
  },
  update: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => state.company,
  useUpdateCompany: () => state.update,
}));

const { OffRampCard } = await import("./off-ramp-card");

function render(company?: {
  subscription_status: string;
  canceled_at: string | null;
  offramp_message?: string | null;
}): string {
  state.company.data = company;
  return renderToStaticMarkup(<OffRampCard />);
}

const canceled = {
  subscription_status: "canceled",
  canceled_at: "2026-07-01T00:00:00.000Z",
};

describe("OffRampCard", () => {
  it("says when it stops, and what happens then", () => {
    // The deadline IS the feature. This is not forwarding — it is "tell the
    // people who text you, while we still can".
    const html = render(canceled);
    // canceled_at + 30 days, formatted the way the component does. Derived
    // rather than hardcoded so this passes in any locale — the assertion is
    // "the date is the release date", not "the date is spelled this way".
    const expected = new Date(
      Date.parse(canceled.canceled_at) + 30 * 24 * 60 * 60 * 1000,
    ).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    expect(html).toContain(expected);
    expect(html).toContain("goes back to the phone company");
    expect(html).toContain("whoever gets it next");
  });

  it("still names the deadline in words when the date is unknown", () => {
    const html = render({ ...canceled, canceled_at: null });
    expect(html).toContain("goes back to the phone company");
  });

  it("says plainly that nothing is sent until they write something", () => {
    // Writing the message IS the opt-in. A screen that leaves somebody unsure
    // whether they have set this up is a screen that has failed.
    expect(render(canceled)).toContain("Nothing is sent until you write");
  });

  it("offers an example, never a draft", () => {
    // A message we wrote and they accepted is still ours, sent to people who
    // never agreed to hear from us. The example is a placeholder, so the field
    // is genuinely empty until they type.
    const html = render(canceled);
    expect(html).toContain('placeholder="We');
    expect(html).not.toMatch(/value="We&#x27;ve moved/);
  });

  it("shows nothing at all to a workspace that is still here", () => {
    // Offering this to a paying customer would read as us expecting them to go.
    expect(render({ subscription_status: "active", canceled_at: null })).toBe("");
    expect(render({ subscription_status: "past_due", canceled_at: null })).toBe("");
  });

  it("shows nothing before the company has loaded", () => {
    expect(render(undefined)).toBe("");
  });

  it("offers a way to turn it off once it is on", () => {
    const html = render({ ...canceled, offramp_message: "We moved to 555-0123" });
    expect(html).toContain("Turn off");
  });

  it("does not offer to turn off something that was never on", () => {
    expect(render(canceled)).not.toContain("Turn off");
  });

  it("never argues with the decision to leave", () => {
    // This is a business winding down, and how we behave on the way out is the
    // referral channel (#399). No retention pitch, no guilt.
    const html = render(canceled).toLowerCase();
    for (const pitch of ["stay", "reconsider", "sure you want", "come back", "instead of leaving"]) {
      expect(html, `copy must not say "${pitch}"`).not.toContain(pitch);
    }
  });
});
