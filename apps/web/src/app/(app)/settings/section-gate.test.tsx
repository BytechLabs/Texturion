/**
 * #515 — what a refused person actually gets. The matrix lives in
 * section-access.test.ts; this is about the answer being an ANSWER: the page
 * withheld, the reason said out loud, a way onward, and no redirect that
 * throws away where they were trying to go.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MEMBER_ROLES, canSeeSettingsSection } from "@loonext/shared";

import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";

// Hoisted state the mocked hooks read; each render seeds it.
const state: { pathname: string; role: string } = {
  pathname: "/settings/billing",
  role: "owner",
};

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
}));
// #286: the gate used to ask the server a second question on /settings/team —
// is this refused reader party to an ownership handover — because that page was
// the only way to reach the card which answers one. `team` is now a baseline
// read for every role, so there is no refusal left to make an exception to.
// This throws rather than returning a value: if the request ever comes back,
// the suite says so instead of quietly paying for it on every render.
vi.mock("@/lib/api/ownership", () => ({
  useOwnership: () => {
    throw new Error("the settings gate must not ask about ownership");
  },
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
    const html = render("/settings/billing", "read_only");
    expect(html).toContain('href="/settings"');
  });

  it("says the same clear thing for every section it refuses", () => {
    // Never a blank pane: a blank pane is indistinguishable from a slow load,
    // which turns a clear no into a broken app.
    for (const role of MEMBER_ROLES) {
      for (const section of SETTINGS_SECTIONS) {
        if (canSeeSettingsSection(section.id, role)) continue;
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

describe("#286 — the crew list is open to every role", () => {
  it("shows the roster to everybody, including a role that can change none of it", () => {
    // The Acceptance line: "a new member can identify the owner and the rest of
    // the crew without asking". Opening the page is the whole of it — the page
    // itself hides every control from a role without `team.manage`, and the API
    // refuses each of those calls regardless of what the page draws.
    for (const role of MEMBER_ROLES) {
      expect(render("/settings/team", role), role).toContain(PAGE);
    }
  });

  it("#332: the backup owner reaches the handover with no exception left to make", () => {
    // This used to need one. #332 lets an owner name a BACKUP OWNER — the
    // person who takes the workspace over when the owner is gone — and the
    // database accepts any active member for that job, a spouse on a `member`
    // role being the ordinary case. OwnershipCard still sits on this page, and
    // every ownership email sent before /ownership existed still points here,
    // so gating `team` on `team.manage` aimed a refusal at exactly the person
    // the mechanism was built for. The gate bought its way out by asking the
    // server whether the caller was party to a handover.
    //
    // Opening the roster to the baseline capability retires that question, and
    // with it a request on every render of a page most of its readers open for
    // an entirely different reason. The mock above fails this test if it comes
    // back.
    expect(render("/settings/team", "member")).toContain(PAGE);
  });

  it("is one page, not a spare key", () => {
    expect(render("/settings/billing", "member")).not.toContain(PAGE);
    expect(render("/settings/numbers", "member")).not.toContain(PAGE);
    expect(render("/settings/history", "member")).not.toContain(PAGE);
  });
});
