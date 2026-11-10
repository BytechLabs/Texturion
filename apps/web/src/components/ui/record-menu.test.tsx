/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecordAction } from "@/lib/record-actions/types";

import { RecordContextMenu, RecordOverflowMenu } from "./record-menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const onCopy = vi.fn();
const onDelete = vi.fn();

function actions(overrides: Partial<Record<string, boolean>> = {}): RecordAction[] {
  return [
    { id: "open", label: "Open", group: "primary", allowed: overrides.open ?? true },
    { id: "copy", label: "Copy", group: "primary", allowed: true, onSelect: onCopy },
    { id: "pin", label: "Pinned", group: "state", allowed: true, checked: true },
    {
      id: "delete",
      label: "Delete",
      group: "danger",
      allowed: overrides.delete ?? true,
      destructive: true,
      onSelect: onDelete,
    },
  ];
}

function menuIds(): string[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] [data-action]'),
  ).map((el) => el.getAttribute("data-action") ?? "");
}

function Row({ list }: { list: RecordAction[] }) {
  return (
    <RecordContextMenu actions={list}>
      <div data-testid="row">
        <button type="button">inside</button>
        <span data-testid="text">Dana wrote this</span>
      </div>
    </RecordContextMenu>
  );
}

describe("#712 RecordContextMenu", () => {
  it("opens on right-click and lists the actions in group order, destructive last", () => {
    render(<Row list={actions()} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(menuIds()).toEqual(["open", "copy", "pin", "delete"]);
    const last = document.querySelector('[data-action="delete"]');
    expect(last?.getAttribute("data-variant")).toBe("destructive");
  });

  it("draws a toggle as a checkbox item that carries its state", () => {
    render(<Row list={actions()} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    const pin = screen.getByRole("menuitemcheckbox", { name: "Pinned" });
    expect(pin.getAttribute("aria-checked")).toBe("true");
  });

  it("separates the groups with exactly one rule between each", () => {
    render(<Row list={actions()} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(document.querySelectorAll('[role="menu"] [role="separator"]').length).toBe(2);
  });

  it("runs the action and closes", async () => {
    onCopy.mockReset();
    render(<Row list={actions()} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("does not show an action the viewer may not take", () => {
    render(<Row list={actions({ delete: false, open: false })} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(menuIds()).toEqual(["copy", "pin"]);
  });

  it("opens nothing for a row with nothing allowed, and leaves the browser's menu alone", () => {
    const none = actions().map((action) => ({ ...action, allowed: false }));
    render(<Row list={none} />);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(notPrevented).toBe(true);
  });

  it("keeps the browser's own menu for selected text inside the row", () => {
    render(<Row list={actions()} />);
    const text = screen.getByTestId("text").firstChild as Text;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "wrote",
      getRangeAt: () => ({ commonAncestorContainer: text }),
    } as unknown as Selection);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId("text"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(notPrevented).toBe(true);
  });

  it("ignores a selection that is somewhere else on the page", () => {
    render(
      <>
        <p data-testid="elsewhere">Unrelated copy</p>
        <Row list={actions()} />
      </>,
    );
    const elsewhere = screen.getByTestId("elsewhere").firstChild as Text;
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "Unrelated",
      getRangeAt: () => ({ commonAncestorContainer: elsewhere }),
    } as unknown as Selection);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("opens from the menu key on a focused control inside the row and gives focus back on Escape", async () => {
    render(<Row list={actions()} />);
    const inside = screen.getByRole("button", { name: "inside" });
    inside.focus();
    // The menu key and Shift+F10 both make the browser dispatch `contextmenu`
    // at the focused element, which bubbles to the row.
    fireEvent.contextMenu(inside);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(inside));
  });
});

describe("#712 RecordOverflowMenu", () => {
  it("lists exactly what the right-click menu lists, in the same order", () => {
    const list = actions();
    const first = render(<RecordOverflowMenu actions={list} label="More" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    const fromButton = menuIds();
    first.unmount();
    cleanup();

    render(<Row list={list} />);
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(menuIds()).toEqual(fromButton);
  });

  it("renders no button when nothing is allowed (#713)", () => {
    const none = actions().map((action) => ({ ...action, allowed: false }));
    const { container } = render(<RecordOverflowMenu actions={none} label="More" />);
    expect(container.innerHTML).toBe("");
  });
});
