/**
 * @vitest-environment happy-dom
 *
 * #504 — who gets a getting-started card, and who gets nothing.
 *
 * The gate used to ask a RANK question ("owner or admin?") where the honest one
 * is a CAPABILITY question ("can this person do the things on the list?"). The
 * two agree for owner, admin and member and disagree for `read_only`, which
 * holds only `workspace.access` and `conversations.read` — so an observer was
 * handed a checklist of three things they provably cannot do, on the surface
 * they land on, which could never empty itself.
 *
 * The second property matters as much as the first: an audience that sees no
 * card must FETCH nothing. "Render null after loading" would still cost a
 * read-only member four requests on every inbox visit. The same holds for a
 * card somebody dismissed, and for the usage read once a first reply is known.
 */
import { cleanup, render as mount } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@loonext/shared";

let role: MemberRole = "owner";

type Result = { data: unknown };
const none = (): Result => ({ data: undefined });

const useCompany = vi.fn<() => Result>(none);
const useConversations = vi.fn<() => Result>(none);
const useUsage = vi.fn<(options?: { enabled?: boolean }) => Result>(none);
const useMembers = vi.fn<() => Result>(none);
const useMemberFirsts = vi.fn<(enabled: boolean) => Result>(none);

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role }),
}));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => useCompany() }));
vi.mock("@/lib/api/conversations", () => ({
  useConversations: () => useConversations(),
}));
vi.mock("@/lib/api/usage", () => ({
  useUsage: (options?: { enabled?: boolean }) => useUsage(options),
}));
vi.mock("@/lib/api/team", () => ({ useMembers: () => useMembers() }));
vi.mock("@/lib/api/me-company", () => ({
  useMemberFirsts: (enabled: boolean) => useMemberFirsts(enabled),
}));

import { GettingStartedCard } from "./getting-started-card";

const render = (as: MemberRole) => {
  role = as;
  return mount(<GettingStartedCard />).container.innerHTML;
};

/** Every query any card makes. None may run for an audience with no card. */
const queries = [
  useCompany,
  useConversations,
  useUsage,
  useMembers,
  useMemberFirsts,
];

/** A paid workspace with a live number, a first text and nobody invited yet. */
function setUpOwnerData(usedSegments: number) {
  useCompany.mockImplementation(() => ({
    data: { subscription_status: "active", numbers: [{ status: "active" }] },
  }));
  useConversations.mockImplementation(() => ({
    data: { pages: [{ data: [{ id: "conv-1" }] }] },
  }));
  useUsage.mockImplementation((options) => ({
    data: options?.enabled === false ? undefined : { used_segments: usedSegments },
  }));
  useMembers.mockImplementation(() => ({
    data: { data: [{ deactivated_at: null }] },
  }));
}

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  for (const query of queries) {
    query.mockReset();
    query.mockImplementation(none);
  }
});

describe("GettingStartedCard audience (#504)", () => {
  it("gives a read_only observer no card at all", () => {
    expect(render("read_only")).toBe("");
  });

  it("costs a read_only observer nothing to be shown nothing", () => {
    render("read_only");

    // Not "renders null after fetching" — never fetches. A card nobody sees
    // must not put four requests on every inbox visit.
    for (const query of queries) expect(query).not.toHaveBeenCalled();
  });

  it("gives a bookkeeper no card either", () => {
    // It does not reach the inbox today, so this is belt-and-braces — but the
    // capability answer is the same one, and it stays right if it ever does.
    expect(render("bookkeeper")).toBe("");
  });

  it("gives a member the doing-the-job list", () => {
    render("member");

    expect(useMemberFirsts).toHaveBeenCalledWith(true);
    // ...and none of the setup queries, which is the #405 promise.
    expect(useCompany).not.toHaveBeenCalled();
    expect(useMembers).not.toHaveBeenCalled();
  });

  it("gives an owner the setup list", () => {
    render("owner");

    expect(useCompany).toHaveBeenCalled();
    expect(useMemberFirsts).not.toHaveBeenCalled();
  });

  it("gives an admin the setup list too", () => {
    render("admin");

    expect(useCompany).toHaveBeenCalled();
    expect(useMemberFirsts).not.toHaveBeenCalled();
  });

  it("fails closed on a role this build has never heard of", () => {
    // The database enum can grow a value ahead of a deployed client, and the
    // role arrives here as data from a row. Showing an unknown role the OWNER
    // list would be the worst of the three answers.
    expect(render("auditor" as MemberRole)).toBe("");
    for (const query of queries) expect(query).not.toHaveBeenCalled();
  });
});

describe("GettingStartedCard reads only what it still needs", () => {
  it("GS-1: a dismissed owner card makes no requests", () => {
    window.localStorage.setItem("loonext:getting-started-dismissed:c-1", "1");

    expect(render("owner")).toBe("");
    for (const query of queries) expect(query).not.toHaveBeenCalled();
  });

  it("GS-2: a dismissed member card never asks for the member's firsts", () => {
    window.localStorage.setItem("loonext:member-started-dismissed:c-1", "1");

    expect(render("member")).toBe("");
    expect(useMemberFirsts).not.toHaveBeenCalledWith(true);
  });

  it("GS-3: a first reply seen on usage is remembered for every later visit", () => {
    setUpOwnerData(3);

    render("owner");

    expect(
      window.localStorage.getItem("loonext:getting-started-replied:c-1"),
    ).toBe("1");
  });

  it("GS-4: a remembered first reply ticks the step without reading usage", () => {
    window.localStorage.setItem("loonext:getting-started-replied:c-1", "1");
    setUpOwnerData(0);

    const html = render("owner");

    expect(useUsage).not.toHaveBeenCalledWith({ enabled: true });
    expect(useUsage).toHaveBeenCalledWith({ enabled: false });
    expect(html).toContain("Send your first reply<span class=\"sr-only\">, done");
  });

  it("GS-5: with no reply yet, usage is read and the step stays open", () => {
    setUpOwnerData(0);

    const html = render("owner");

    expect(useUsage).toHaveBeenCalledWith({ enabled: true });
    expect(html).toContain("Send your first reply<span class=\"sr-only\">, not done");
    expect(
      window.localStorage.getItem("loonext:getting-started-replied:c-1"),
    ).toBeNull();
  });
});
