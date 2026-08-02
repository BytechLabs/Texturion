/**
 * #515 — what a refused person actually gets. The matrix lives in
 * section-access.test.ts; this is about the answer being an ANSWER: the page
 * withheld, the reason said out loud, a way onward, and no redirect that
 * throws away where they were trying to go.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_ROLES, canSeeSettingsSection } from "@loonext/shared";

import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";

import type { Ownership } from "@/lib/api/ownership";

// Hoisted state the mocked hooks read; each render seeds it.
const state: {
  pathname: string;
  role: string;
  ownership: { isPending: boolean; data: Ownership | undefined };
} = {
  pathname: "/settings/billing",
  role: "owner",
  ownership: { isPending: false, data: undefined },
};

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
}));
vi.mock("@/lib/api/ownership", () => ({
  useOwnership: () => state.ownership,
}));

import { SettingsSectionGate } from "./section-gate";

/** The thing a refused reader must never be shown. */
const PAGE = "the-page-behind-the-gate";

function render(pathname: string, role: string): string {
  state.pathname = pathname;
  state.role = role;
  return renderToStaticMarkup(
    <SettingsSectionGate>
      <p>{PAGE}</p>
    </SettingsSectionGate>,
  );
}

function ownership(overrides: Partial<Ownership> = {}): Ownership {
  return {
    owner_member_id: "m_owner",
    backup_member_id: null,
    i_am_backup: false,
    i_am_owner: false,
    pending: null,
    can_offer: false,
    can_claim: false,
    can_cancel: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.ownership = { isPending: false, data: undefined };
});

describe("the page a role may open", () => {
  it("renders it untouched", () => {
    expect(render("/settings/billing", "owner")).toContain(PAGE);
    expect(render("/settings/workspace", "admin")).toContain(PAGE);
  });

  it("gives a bookkeeper the billing pages the preset exists for", () => {
    // #315: the role was created so an owner can hand over the books WITHOUT
    // handing over every customer conversation. A gate that shut them out of
    // billing would leave the preset with nothing at all.
    expect(render("/settings/billing", "bookkeeper")).toContain(PAGE);
    expect(render("/settings/usage", "bookkeeper")).toContain(PAGE);
  });

  it("leaves the section list open to everybody", () => {
    for (const role of MEMBER_ROLES) {
      expect(render("/settings", role), role).toContain(PAGE);
    }
  });
});

describe("the page a role may not open", () => {
  it("withholds it and says why", () => {
    const html = render("/settings/billing", "member");
    expect(html).not.toContain(PAGE);
    // Names the section, so somebody following a link knows the link was fine
    // and it is the access that is missing.
    expect(html).toContain("have access to Billing");
    expect(html).toContain("Ask an owner or an admin");
  });

  it("offers a way onward rather than a dead end", () => {
    // No redirect — that would erase the destination and answer a question
    // nobody asked. One link instead, which is also the only route back on a
    // phone, where the nav is not on screen beside this.
    const html = render("/settings/team", "read_only");
    expect(html).toContain('href="/settings"');
  });

  it("says the same clear thing for every section it refuses", () => {
    // Never a blank pane: a blank pane is indistinguishable from a slow load,
    // which turns a clear no into a broken app.
    for (const role of MEMBER_ROLES) {
      for (const section of SETTINGS_SECTIONS) {
        if (canSeeSettingsSection(section.id, role)) continue;
        if (section.id === "team") continue; // asked its own question below
        const html = render(`/settings/${section.slug}`, role);
        expect(html, `${role}/${section.slug}`).not.toContain(PAGE);
        expect(html, `${role}/${section.slug}`).toContain("have access to");
        expect(html.trim().length, `${role}/${section.slug}`).toBeGreaterThan(
          100,
        );
      }
    }
  });

  it("refuses an unclaimed route to everybody, owner included", () => {
    const html = render("/settings/payroll", "owner");
    expect(html).not.toContain(PAGE);
    expect(html).toContain("have access to this page");
  });
});

describe("#332 — the backup owner can still reach the handover", () => {
  it("lets the named backup owner in, whatever their role", () => {
    // The whole point of naming a backup is that they can act when the owner
    // cannot. The card still sits on the Team page, and ownership emails sent
    // before /ownership existed still point at it, so gating `team` on
    // team.manage alone would aim a refusal at exactly the person the
    // mechanism was built for.
    state.ownership = { isPending: false, data: ownership({ i_am_backup: true }) };
    expect(render("/settings/team", "member")).toContain(PAGE);
    expect(render("/settings/team", "read_only")).toContain(PAGE);
  });

  it("lets in whoever a pending handover is addressed to", () => {
    state.ownership = {
      isPending: false,
      data: ownership({
        pending: {
          kind: "offer",
          to_member_id: "m_me",
          ripens_at: "2026-08-09T00:00:00Z",
          expires_at: "2026-08-16T00:00:00Z",
          created_at: "2026-08-02T00:00:00Z",
          mine: true,
          ready: true,
        },
      }),
    };
    expect(render("/settings/team", "member")).toContain(PAGE);
  });

  it("keeps everyone else off the roster", () => {
    // A handover that is not theirs is not a key to the team list.
    state.ownership = {
      isPending: false,
      data: ownership({
        pending: {
          kind: "claim",
          to_member_id: "m_someone_else",
          ripens_at: "2026-08-09T00:00:00Z",
          expires_at: "2026-08-16T00:00:00Z",
          created_at: "2026-08-02T00:00:00Z",
          mine: false,
          ready: false,
        },
      }),
    };
    const html = render("/settings/team", "member");
    expect(html).not.toContain(PAGE);
    expect(html).toContain("have access to Team");
  });

  it("refuses when the answer never arrives", () => {
    // Fail closed. The server refuses every action on this page regardless,
    // but the roster is a read and the read is the leak.
    state.ownership = { isPending: false, data: undefined };
    expect(render("/settings/team", "member")).not.toContain(PAGE);
  });

  it("shows neither answer while it is still asking", () => {
    // Rendering the page or the refusal early would flash the wrong one at
    // somebody who is about to be told the opposite.
    state.ownership = { isPending: true, data: undefined };
    const html = render("/settings/team", "member");
    expect(html).not.toContain(PAGE);
    expect(html).not.toContain("have access to");
  });

  it("does not open any other section for them", () => {
    // The exception is about one card on one page, not a spare key.
    state.ownership = { isPending: false, data: ownership({ i_am_backup: true }) };
    expect(render("/settings/billing", "member")).not.toContain(PAGE);
    expect(render("/settings/numbers", "member")).not.toContain(PAGE);
    expect(render("/settings/history", "member")).not.toContain(PAGE);
  });
});
