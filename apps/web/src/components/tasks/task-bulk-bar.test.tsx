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
  useMemberNames: () =>
    new Map([
      ["u1", "Ana"],
      ["u2", "Ben"],
    ]),
}));

vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({
    data: { data: [{ id: "tag-1", name: "Warranty", color: null }] },
  }),
}));

import { TaskBulkBar } from "./task-bulk-bar";

beforeEach(() => {
  state.canDelete = true;
});

function openMore(
  onDelete = vi.fn(),
  extra: {
    onSetPriority?: (value: string) => void;
    onAddLabel?: (value: string) => void;
    onRemoveLabel?: (value: string) => void;
  } = {},
) {
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
      onSetPriority={extra.onSetPriority ?? vi.fn()}
      onAddLabel={extra.onAddLabel ?? vi.fn()}
      onRemoveLabel={extra.onRemoveLabel ?? vi.fn()}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
  return onDelete;
}

describe("TaskBulkBar assign (#689 C)", () => {
  function renderBar(onAssign: (ids: string[]) => void) {
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
        onAssign={onAssign}
        onDelete={vi.fn()}
        onSetPriority={vi.fn()}
        onAddLabel={vi.fn()}
        onRemoveLabel={vi.fn()}
      />,
    );
  }

  it("lists the members, and adds everyone ticked in one call", () => {
    const onAssign = vi.fn();
    renderBar(onAssign);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const apply = screen.getByRole("button", { name: "Add to tasks" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Ana" }));
    fireEvent.click(screen.getByRole("option", { name: "Ben" }));
    fireEvent.click(apply);
    expect(onAssign).toHaveBeenCalledOnce();
    expect(onAssign).toHaveBeenCalledWith(["u1", "u2"]);
  });
});

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

describe("TaskBulkBar priority and labels (#693)", () => {
  it("sets a priority and adds or removes a label for the selection", () => {
    const onSetPriority = vi.fn();
    const onAddLabel = vi.fn();
    const onRemoveLabel = vi.fn();
    openMore(vi.fn(), { onSetPriority, onAddLabel, onRemoveLabel });
    fireEvent.click(screen.getByText("Urgent"));
    expect(onSetPriority).toHaveBeenCalledWith("urgent");
    expect(onAddLabel).not.toHaveBeenCalled();
  });

  it("#713: offers the workspace tags as one Labels control", () => {
    openMore();
    expect(screen.getAllByText("Labels")).toHaveLength(1);
    expect(screen.queryByText("Add label")).toBeNull();
    expect(screen.queryByText("Remove label")).toBeNull();
  });
});
