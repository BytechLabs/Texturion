/**
 * @vitest-environment happy-dom
 *
 * #713: one Tags control instead of Tag and Untag, and no "More" menu that
 * opens on nothing for a member who may neither merge nor delete.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const state = { canDelete: false };

vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => state.canDelete,
}));
vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({ data: { data: [{ id: "tag-1", name: "Warranty", color: null }] } }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useBulkContacts: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/contacts-export-hook", () => ({
  useExportContacts: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/contacts/duplicate-contacts-card", () => ({
  MergeDialog: () => null,
}));

import type { ContactListItem } from "@/lib/api/types";

import { ContactsBulkBar } from "./contacts-bulk-bar";

beforeEach(() => {
  state.canDelete = false;
});

const ROWS = [
  { id: "c1", name: "Ana", phone_e164: "+16135550101", tags: [{ id: "tag-1", name: "Warranty" }] },
  { id: "c2", name: "Ben", phone_e164: "+16135550102", tags: [] },
] as unknown as ContactListItem[];

function renderBar(canMerge: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactsBulkBar selected={ROWS} canEdit canMerge={canMerge} onClear={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ContactsBulkBar", () => {
  it("offers one Tags control, not Tag and Untag", () => {
    renderBar(false);
    expect(screen.getByRole("button", { name: "Tags" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tag" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Untag" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Tags" }), { key: "Enter" });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Warranty" }).getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("shows no More menu to a member who may neither merge nor delete", () => {
    renderBar(false);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("shows More when either item is allowed", () => {
    state.canDelete = true;
    renderBar(false);
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    cleanup();
    state.canDelete = false;
    renderBar(true);
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });
});
