import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Ownership } from "@/lib/api/ownership";
import type { Member } from "@/lib/api/types";

/**
 * #332 — the ownership card.
 *
 * These pin the parts that are about SAFETY rather than layout: a handover in
 * flight is shown to everybody (including the plain member who is neither
 * side of it), a workspace with no backup named says so where the owner will
 * see it, and no button that hands a business to somebody appears for a caller
 * the server did not authorise.
 */

const members: Member[] = [
  {
    id: "m-owner",
    user_id: "u-owner",
    role: "owner",
    deactivated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    display_name: "Sam Founder",
  },
  {
    id: "m-partner",
    user_id: "u-partner",
    role: "admin",
    deactivated_at: null,
    created_at: "2026-02-01T00:00:00Z",
    display_name: "Riley Partner",
  },
];

let state: Ownership = {
  owner_member_id: "m-owner",
  backup_member_id: null,
  i_am_backup: false,
  i_am_owner: true,
  pending: null,
  can_offer: true,
  can_claim: false,
  can_cancel: false,
};

vi.mock("@/lib/api/ownership", () => ({
  useOwnership: () => ({
    isPending: false,
    isError: false,
    data: state,
  }),
  useOwnershipAction: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));

import { OwnershipCard } from "./ownership-card";

const render = () => renderToStaticMarkup(<OwnershipCard members={members} />);

describe("OwnershipCard", () => {
  it("tells an owner with no backup that nobody is named", () => {
    state = { ...state, i_am_owner: true, backup_member_id: null };
    const html = render();
    expect(html).toContain("Nobody named");
    // And says what that costs them, rather than just flagging a gap.
    expect(html).toContain("this is the one person who can ask to take over");
  });

  it("offers no handover controls to somebody who is not the owner", () => {
    state = {
      ...state,
      i_am_owner: false,
      can_offer: false,
      can_claim: false,
      can_cancel: false,
    };
    const html = render();
    expect(html).not.toContain("Hand it over");
    expect(html).not.toContain("Ask to take over");
    expect(html).not.toContain("Backup owner");
    // They still see who owns the place. It is their workspace too.
    expect(html).toContain("Sam Founder");
  });

  it("shows the claim button only to the named backup", () => {
    state = { ...state, i_am_owner: false, i_am_backup: true, can_claim: true };
    expect(render()).toContain("Ask to take over");
  });

  it("shows a claim in flight to a member who is neither side of it", () => {
    state = {
      ...state,
      i_am_owner: false,
      i_am_backup: false,
      can_claim: false,
      can_cancel: false,
      pending: {
        kind: "claim",
        to_member_id: "m-partner",
        ripens_at: "2026-08-05T12:00:00Z",
        expires_at: "2027-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: false,
        ready: false,
      },
    };
    const html = render();
    // The whole reason everybody sees this: a colleague who knows the owner
    // is on holiday is the alarm.
    expect(html).toContain("has asked to take over this workspace");
    expect(html).toContain("unless the owner stops it");
    // No buttons for them — seeing is not acting.
    expect(html).not.toContain("Stop this");
  });

  it("gives the owner a veto for the whole waiting period", () => {
    state = { ...state, i_am_owner: true, can_cancel: true };
    expect(render()).toContain("Stop this");
  });

  it("does not offer to complete a claim before its waiting period is over", () => {
    state = {
      ...state,
      i_am_owner: false,
      can_cancel: true,
      pending: {
        kind: "claim",
        to_member_id: "m-partner",
        ripens_at: "2026-08-05T12:00:00Z",
        expires_at: "2027-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: true,
        ready: false,
      },
    };
    const html = render();
    expect(html).not.toContain("Complete the takeover");
    // The claimant can still abandon their own claim.
    expect(html).toContain("Decline");
  });

  it("offers acceptance once the server says it is ready", () => {
    state = {
      ...state,
      i_am_owner: false,
      pending: {
        kind: "offer",
        to_member_id: "m-partner",
        ripens_at: "2026-07-29T12:00:00Z",
        expires_at: "2026-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: true,
        ready: true,
      },
    };
    expect(render()).toContain("Accept ownership");
  });
});
