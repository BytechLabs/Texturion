import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MyInvite } from "@/lib/api/types";

/**
 * #109: the ambient "you've been invited — Join" banner. Pins the render
 * contract: a pending invite shows the company name + a Join link to the
 * canonical /invite/:id accept page; no pending invites (or none loaded yet)
 * renders NOTHING — the banner is ambient, never blocking.
 */
const state = {
  invites: [] as MyInvite[],
  pending: false,
};

vi.mock("@/lib/api/team", () => ({
  useMyInvites: () => ({
    isPending: state.pending,
    isError: false,
    data: state.pending ? undefined : { data: state.invites },
  }),
}));

import { InviteBanner } from "./invite-banner";

function myInvite(overrides: Partial<MyInvite> = {}): MyInvite {
  return {
    id: "ffffffff-1111-4222-8333-444444444444",
    company_id: "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d",
    email: "crew@example.com",
    role: "member",
    invited_by: "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a",
    expires_at: "2027-01-01T00:00:00+00:00",
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-07-10T00:00:00+00:00",
    company_name: "Acme Plumbing",
    ...overrides,
  };
}

beforeEach(() => {
  state.invites = [];
  state.pending = false;
});

describe("InviteBanner (#109)", () => {
  it("shows the newest pending invite with the company name and a Join link", () => {
    state.invites = [myInvite()];
    const html = renderToStaticMarkup(<InviteBanner />);
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain("invited to join");
    expect(html).toContain(
      'href="/invite/ffffffff-1111-4222-8333-444444444444"',
    );
    expect(html).toContain("Dismiss invite");
  });

  it("falls back to plain copy when the company name is missing", () => {
    state.invites = [myInvite({ company_name: null })];
    const html = renderToStaticMarkup(<InviteBanner />);
    expect(html).toContain("a Loonext workspace");
  });

  it("renders NOTHING with no pending invites, and NOTHING while loading", () => {
    expect(renderToStaticMarkup(<InviteBanner />)).toBe("");
    state.pending = true;
    expect(renderToStaticMarkup(<InviteBanner />)).toBe("");
  });
});
