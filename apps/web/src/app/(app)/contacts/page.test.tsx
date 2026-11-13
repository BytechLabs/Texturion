/**
 * D20: the export mirrors the view, and the view is the URL, so the toolbar
 * reads the search and the tag from it (and from a link or Back as well).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const url = { search: "" };

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));
vi.mock("@/components/contacts/contacts-actions", () => ({
  ContactsActions: ({ query, tagId }: { query: string; tagId?: string }) => (
    <p>
      export:{query}|{tagId ?? "none"}
    </p>
  ),
  NewContactAction: () => null,
}));
vi.mock("@/components/contacts/duplicate-contacts-card", () => ({
  DuplicateContactsCard: () => null,
}));
vi.mock("@/components/contacts/contacts-table", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/contacts/contacts-table")>()),
  ContactsTable: () => null,
}));

import ContactsPage from "./page";

describe("/contacts export toolbar", () => {
  it("exports the search and tag the URL names", () => {
    url.search = "q=smith&tag=t-1&new=6135550101";
    expect(renderToStaticMarkup(<ContactsPage />)).toContain("export:smith|t-1");
  });

  it("exports everything when the URL names nothing", () => {
    url.search = "";
    expect(renderToStaticMarkup(<ContactsPage />)).toContain("export:|none");
  });
});
