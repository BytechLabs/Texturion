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
 * read-only member four requests on every inbox visit.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@loonext/shared";

let role: MemberRole = "owner";

const useCompany = vi.fn(() => ({ data: undefined }));
const useConversations = vi.fn(() => ({ data: undefined }));
const useUsage = vi.fn(() => ({ data: undefined }));
const useMembers = vi.fn(() => ({ data: undefined }));
const useMemberFirsts = vi.fn(() => ({ data: undefined }));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role }),
}));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => useCompany() }));
vi.mock("@/lib/api/conversations", () => ({
  useConversations: () => useConversations(),
}));
vi.mock("@/lib/api/usage", () => ({ useUsage: () => useUsage() }));
vi.mock("@/lib/api/team", () => ({ useMembers: () => useMembers() }));
vi.mock("@/lib/api/me-company", () => ({
  useMemberFirsts: () => useMemberFirsts(),
}));

import { GettingStartedCard } from "./getting-started-card";

const render = (as: MemberRole) => {
  role = as;
  return renderToStaticMarkup(<GettingStartedCard />);
};

/** Every query any card makes. None may run for an audience with no card. */
const queries = [
  useCompany,
  useConversations,
  useUsage,
  useMembers,
  useMemberFirsts,
];

describe("GettingStartedCard audience (#504)", () => {
  beforeEach(() => {
    queries.forEach((q) => q.mockClear());
  });

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

    expect(useMemberFirsts).toHaveBeenCalled();
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
