/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrashRow } from "@/lib/api/trash";

afterEach(cleanup);

const purgeMutate = vi.fn();
const restoreMutate = vi.fn();
const state = { rows: [] as TrashRow[] };

vi.mock("@/lib/api/trash", () => ({
  useTrash: () => ({
    isPending: false,
    isError: false,
    hasNextPage: false,
    data: { pages: [{ data: state.rows, next_cursor: null }] },
    refetch: vi.fn(),
  }),
  usePurgeTrashItem: () => ({ mutate: purgeMutate, isPending: false }),
  useRestoreFromTrash: () => ({ mutate: restoreMutate, isPending: false }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: { data: [{ user_id: "u-2", display_name: "Priya Natarajan" }] },
  }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", userId: "u-1", role: "owner" }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TrashList } from "./trash-list";

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString();

const CONVERSATION: TrashRow = {
  kind: "conversation",
  id: "c-1",
  deleted_at: new Date().toISOString(),
  deleted_by_user_id: "u-2",
  purge_after: inDays(29),
  conversation: {
    contact_name: "Dana Rivera",
    contact_phone: "+12125550123",
    message_count: 4,
  },
};

beforeEach(() => {
  purgeMutate.mockReset();
  restoreMutate.mockReset();
  state.rows = [CONVERSATION];
});

describe("TrashList", () => {
  it("says who, what, who deleted it, and how long is left", () => {
    render(<TrashList />);
    expect(screen.getByText("Dana Rivera")).toBeTruthy();
    expect(screen.getByText("4 messages")).toBeTruthy();
    expect(screen.getByText(/by Priya Natarajan/)).toBeTruthy();
    expect(screen.getByText(/30 days left/)).toBeTruthy();
  });

  it("restores the row's kind and id", () => {
    render(<TrashList />);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restoreMutate.mock.calls[0][0]).toEqual([
      { kind: "conversation", id: "c-1" },
    ]);
  });

  it("keeps a call and its voicemail apart even though they share an id", () => {
    state.rows = [
      {
        kind: "call",
        id: "x-1",
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: null,
        purge_after: inDays(5),
        call: {
          contact_name: null,
          contact_phone: null,
          outcome: "voicemail",
          started_at: new Date().toISOString(),
          has_voicemail: true,
        },
      },
      {
        kind: "voicemail",
        id: "x-1",
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: null,
        purge_after: inDays(5),
        voicemail: {
          contact_name: null,
          contact_phone: null,
          started_at: new Date().toISOString(),
          voicemail_seconds: 12,
        },
      },
    ];
    render(<TrashList />);
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
  });

  it("makes Delete forever wait for the typed word, and purges only then", () => {
    render(<TrashList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));

    expect(screen.getByText("Delete this forever?")).toBeTruthy();
    expect(screen.getByText(/can't be undone/)).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "Delete forever" })
      .find((button) => button.closest("[role=dialog]")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const field = screen.getByLabelText("Type DELETE to confirm");
    fireEvent.change(field, { target: { value: "delet" } });
    expect(confirm.disabled).toBe(true);
    expect(purgeMutate).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "delete" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(purgeMutate.mock.calls[0][0]).toEqual({
      kind: "conversation",
      id: "c-1",
    });
  });
});
