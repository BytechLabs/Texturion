/**
 * @vitest-environment happy-dom
 *
 * #691 The bulk Delete item shows only to a member holding records.delete.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const state = { canDelete: true };

vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => state.canDelete,
}));
vi.mock("@/components/inbox/member-avatar", () => ({
  MemberAvatar: () => null,
  useMemberNames: () => ({}),
}));

import { TaskBulkBar } from "./task-bulk-bar";

beforeEach(() => {
  state.canDelete = true;
});

function openMore(onDelete = vi.fn()) {
  render(
    <TaskBulkBar
      selection={{ mode: "ids", ids: new Set(["a"]) }}
      loadedIds={["a"]}
      hasMore={false}
      pending={false}
      onSelectLoaded={vi.fn()}
      onSelectAllMatching={vi.fn()}
      onClear={vi.fn()}
      onMarkDone={vi.fn()}
      onMarkUndone={vi.fn()}
      onAssign={vi.fn()}
      onDelete={onDelete}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
  return onDelete;
}

describe("TaskBulkBar delete (#691)", () => {
  it("hides Delete from a member without records.delete", () => {
    state.canDelete = false;
    openMore();
    expect(screen.getByText("Mark not done")).toBeTruthy();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("offers Delete to a member with records.delete", () => {
    const onDelete = openMore();
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
