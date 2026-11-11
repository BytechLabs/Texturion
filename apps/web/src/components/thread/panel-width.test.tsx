/**
 * @vitest-environment happy-dom
 */
/**
 * #742: the grip pill drags. Dragging from the pill or the border resizes the
 * panel live and saves on release; arrows and a double-click are the no-drag
 * paths on the border; the preset widths sit in the panel's own menu.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH_KEY,
  PanelOverflowMenu,
  PanelResizeHandle,
  usePanelWidth,
} from "./panel-width";

function Harness() {
  const { width, widthRef, resize, commit } = usePanelWidth();
  return (
    <div>
      <output data-testid="width">{width}</output>
      <PanelOverflowMenu width={width} onCommit={commit} />
      <PanelResizeHandle
        width={width}
        widthRef={widthRef}
        onResize={resize}
        onCommit={commit}
      />
    </div>
  );
}

const shown = () => Number(screen.getByTestId("width").textContent);
const saved = () => window.localStorage.getItem(PANEL_WIDTH_KEY);
const move = (clientX: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX }));
  });
const release = () =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup"));
  });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("#742 panel width", () => {
  it("dragging from the grip pill widens live and saves only on release", () => {
    render(<Harness />);
    const pill = screen.getByTestId("panel-grip");
    fireEvent.pointerDown(pill, { clientX: 500 });
    move(450); // left is wider
    expect(shown()).toBe(PANEL_DEFAULT_WIDTH + 50);
    expect(saved()).toBeNull();
    move(480);
    expect(shown()).toBe(PANEL_DEFAULT_WIDTH + 20);
    release();
    expect(saved()).toBe(String(PANEL_DEFAULT_WIDTH + 20));
  });

  it("the pill opens nothing: no menu, no button", () => {
    render(<Harness />);
    const pill = screen.getByTestId("panel-grip");
    expect(pill.closest("button")).toBeNull();
    fireEvent.pointerDown(pill, { clientX: 500 });
    release();
    fireEvent.click(pill);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a drag clamps to the limits", () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByRole("separator"), { clientX: 500 });
    move(-2000);
    expect(shown()).toBe(PANEL_MAX_WIDTH);
    move(3000);
    expect(shown()).toBe(PANEL_MIN_WIDTH);
    release();
  });

  it("arrow keys nudge by 16, Shift by 64, and save", () => {
    render(<Harness />);
    const bar = screen.getByRole("separator");
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(shown()).toBe(PANEL_DEFAULT_WIDTH + 16);
    fireEvent.keyDown(bar, { key: "ArrowRight", shiftKey: true });
    // 316 - 64 = 252, clamped up to the minimum.
    expect(shown()).toBe(PANEL_MIN_WIDTH);
    expect(saved()).toBe(String(shown()));
    fireEvent.keyDown(bar, { key: "End" });
    expect(shown()).toBe(PANEL_MAX_WIDTH);
  });

  it("double-click resets to the default", () => {
    render(<Harness />);
    const bar = screen.getByRole("separator");
    fireEvent.keyDown(bar, { key: "End" });
    fireEvent.doubleClick(bar);
    expect(shown()).toBe(PANEL_DEFAULT_WIDTH);
    expect(saved()).toBe(String(PANEL_DEFAULT_WIDTH));
  });

  it("the presets are items in the panel's own menu", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Panel options" }), {
      key: "Enter",
    });
    expect(screen.getByText("Panel width")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Wide" }));
    expect(shown()).toBe(440);
    expect(saved()).toBe("440");
  });
});
