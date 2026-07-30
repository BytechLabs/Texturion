import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ComposerBanner } from "./composer-banner";

/**
 * The banner that REPLACES the composer. Pins the rule that every kind names
 * something the reader can do, because a banner with no way forward is a dead
 * end at exactly the moment a customer is waiting for a reply.
 */
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));

vi.mock("@/lib/api/billing", () => ({
  useBillingPortal: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: { overage_cap_multiplier: 2 } }),
  useUpdateCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/softphone/provider", () => ({
  useSoftphone: () => ({ calls: [], placeCall: vi.fn() }),
  MicPermissionError: class extends Error {},
}));

import { ComposerBannerCard } from "./composer-banners";

const THREAD = {
  conversationId: "3f1a6c2e-8b4d-4f19-9a70-2c5e8d1b4a63",
  contactName: "Dana Reyes",
  canCall: true,
};

function render(banner: NonNullable<ComposerBanner>, thread = THREAD) {
  return renderToStaticMarkup(
    <ComposerBannerCard banner={banner} thread={thread} />,
  );
}

describe("ComposerBannerCard", () => {
  it("offers the call while US registration is pending", () => {
    // Carrier registration gates texting, not voice, so the call this offers
    // actually connects. The wait is 3 to 7 business days; without an action
    // the banner is a dead end for all of it.
    const html = render({ kind: "registration_pending" });
    expect(html).toContain("Call them instead");
    expect(html).toContain("Call Dana Reyes from your business number");
  });

  it("does not offer a call a note-only member would be refused", () => {
    const html = render({ kind: "registration_pending" }, { ...THREAD, canCall: false });
    expect(html).not.toContain("Call them instead");
  });

  it("never offers to call a customer who texted STOP", () => {
    // A STOP revokes consent for the business to reach out, not just for
    // texts. Offering the phone as a way around it would invite a call that
    // should not be placed.
    const html = render({ kind: "opted_out", carrierBlocked: true });
    expect(html).not.toContain("Call them instead");
    expect(html).toContain("texting START");
  });

  it("keeps the existing billing and cap actions", () => {
    expect(render({ kind: "subscription", status: "past_due" })).toContain(
      "Update payment",
    );
    expect(render({ kind: "usage_cap" })).toContain("Raise cap");
  });
});

describe("the note-only banner (#363/#348)", () => {
  it("names the calls consequence, not just the texting one", () => {
    // #348: dial targets and the call push audience are filtered by 'text'
    // level, so a note-only member also never rings and never gets call
    // notifications — and nothing anywhere said so. The composer banner is the
    // one place they meet the restriction, so it is where the whole truth goes.
    const html = render({ kind: "number_access" });
    expect(html).toContain("internal notes");
    expect(html.toLowerCase()).toContain("ring");
  });

  it("still says who can undo it", () => {
    // G10: what happened, and what to do. The remedy is a conversation with a
    // person, so the sentence has to name which person.
    const html = render({ kind: "number_access" });
    expect(html).toMatch(/owner or admin/i);
  });
});
