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
  useCompany: () => ({
    data: {
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      name: "Ace Plumbing",
      plan: "starter",
      overage_cap_multiplier: 2,
    },
  }),
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

describe("#253 reporting the failure you are looking at", () => {
  it("offers a report path from every banner, including the fixable ones", () => {
    // The tempting rule is "no report link where the reader has a remedy". But
    // deciding which failures deserve a voice is the asymmetry #253 is about:
    // a report we did not need costs one read, and one we never got costs a
    // customer we then record as churn.
    const kinds: NonNullable<ComposerBanner>[] = [
      { kind: "registration_pending" },
      { kind: "registration_suspended" },
      { kind: "us_texting_off" },
      { kind: "usage_cap" },
      { kind: "read_only" },
      { kind: "number_access" },
      { kind: "opt_out_hint" },
      { kind: "opted_out", carrierBlocked: true },
      { kind: "subscription", status: "past_due" },
    ];
    for (const banner of kinds) {
      expect(render(banner), banner.kind).toContain("Report this");
    }
  });

  it("names the exact failure in the subject, so nobody describes a screen", () => {
    const html = render({ kind: "registration_suspended" });
    expect(html).toContain(
      encodeURIComponent("Problem: the carrier suspended our US registration"),
    );
  });

  it("carries the workspace, so the report can be looked up without a reply", () => {
    const html = render({ kind: "usage_cap" });
    expect(html).toContain("7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("stays a quiet link, never a second button competing with the remedy", () => {
    // Where "Raise cap" exists, raising the cap IS the right move and the
    // layout has to say so. This is the door for the person that did not work
    // for — it must not look like the same size of decision.
    const html = render({ kind: "usage_cap" });
    expect(html).toContain("Raise cap");
    const reportTag = html.slice(html.lastIndexOf("<a", html.indexOf("Report this")));
    expect(reportTag).toContain("text-xs");
    expect(reportTag).not.toContain("data-slot=\"button\"");
  });
});
