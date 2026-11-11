/**
 * @vitest-environment happy-dom
 *
 * #743: a list row carries one checkbox (it selects) and the Status cell is
 * the control for changing status.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutate, undoToast } = vi.hoisted(() => ({
  mutate: vi.fn(),
  undoToast: vi.fn(),
}));

const rows = [
  { id: "t1", title: "Call Ana", done: false, status: "open", message_id: "m1", conversation_id: "c1", labels: [], priority: null, repeat: null, number: 1 },
  { id: "t2", title: "Send quote", done: true, status: "done", message_id: "m2", conversation_id: "c2", labels: [], priority: null, repeat: null, number: 2 },
];

vi.mock("@/lib/api/tasks", () => ({
  useTasks: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ data: rows, has_more: false, next_cursor: null }], pageParams: [] },
    hasNextPage: false,
  }),
  useAllTasks: () => ({ isPending: false, isError: false, data: undefined }),
  useBulkTasks: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../use-task-mutations", () => ({
  useTaskDone: () => ({ mutate, isPending: false }),
}));
vi.mock("../task-actions", () => ({
  useTaskRowActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("../task-inline-edit", () => ({
  InlineAssignee: () => null,
  InlineDue: () => null,
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ openTask: vi.fn(), hrefForTask: () => "/" }),
}));
vi.mock("@/lib/use-is-xl", () => ({ useIsXl: () => true }));
vi.mock("@/components/ui/optimistic-undo", () => ({ undoableToast: undoToast }));

import { ListView } from "./list-view";

const state = { view: "list", tab: "done" } as never;

afterEach(cleanup);
beforeEach(() => {
  mutate.mockReset();
  undoToast.mockReset();
});

describe("Tasks list status control (#743)", () => {
  it("renders exactly one checkbox per row, and it selects", () => {
    const { container } = render(<ListView state={state} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(rows.length);
    for (const li of items) {
      const boxes = li.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
      expect(boxes.length).toBe(1);
      expect(boxes[0].getAttribute("aria-label")).toMatch(/^Select /);
    }
    expect(screen.queryByRole("checkbox", { name: /mark (not )?done/i })).toBeNull();
  });

  it("changes status from the Status cell and offers Undo", () => {
    render(<ListView state={state} />);
    const trigger = screen.getAllByRole("button", { name: /Status of Call Ana: Open/ })[0];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Done" }));
    expect(mutate).toHaveBeenCalledWith({
      taskId: "t1",
      messageId: "m1",
      conversationId: "c1",
      done: true,
    });
    expect(undoToast).toHaveBeenCalledOnce();
    undoToast.mock.calls[0][0].onUndo();
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "t1", done: false }));
  });

  it("reopens a done task, and is reachable by keyboard", () => {
    render(<ListView state={state} />);
    const trigger = screen.getAllByRole("button", { name: /Status of Send quote: Done/ })[0];
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const open = screen.getByRole("menuitemradio", { name: "Open" });
    expect(screen.getByRole("menuitemradio", { name: "Done" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(open);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t2", done: false }));
  });

  it("does nothing when the current status is picked again", () => {
    render(<ListView state={state} />);
    const trigger = screen.getAllByRole("button", { name: /Status of Call Ana/ })[0];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Open" }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
