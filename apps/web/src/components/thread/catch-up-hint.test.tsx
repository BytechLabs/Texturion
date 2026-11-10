/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CatchUpHint } from "./catch-up-hint";

afterEach(cleanup);

function renderHint() {
  const handlers = { onRecap: vi.fn(), onNotNow: vi.fn(), returnFocus: vi.fn() };
  render(<CatchUpHint {...handlers} />);
  return handlers;
}

/**
 * #716: the composer's catch-up offer. The hook decides when it shows
 * (`use-catch-up.test.tsx`); this is what the line itself must do.
 */
describe("CatchUpHint", () => {
  it("is announced, and its two answers are real buttons", () => {
    renderHint();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Catch up on this thread?");
    expect(screen.getByRole("button", { name: "Recap" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("says what Recap does before it is pressed, since pressing it is what costs", () => {
    renderHint();
    expect(screen.getByRole("button", { name: "Recap" }).getAttribute("title")).toBe(
      "Lou reads the recent messages",
    );
  });

  it("asks on Recap and dismisses on Not now", () => {
    const handlers = renderHint();
    fireEvent.click(screen.getByText("Recap"), { detail: 1 });
    expect(handlers.onRecap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Not now"), { detail: 1 });
    expect(handlers.onNotNow).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape from inside it, and hands focus back", () => {
    const handlers = renderHint();
    fireEvent.keyDown(screen.getByText("Not now"), { key: "Escape" });
    expect(handlers.onNotNow).toHaveBeenCalledTimes(1);
    expect(handlers.onRecap).not.toHaveBeenCalled();
    expect(handlers.returnFocus).toHaveBeenCalledTimes(1);
  });

  /**
   * The button that held focus is gone after an answer. A keyboard user gets
   * focus back in the composer; a tap does not, because focusing the input on
   * a phone opens its keyboard.
   */
  it("hands focus back after a keyboard answer and not after a tap", () => {
    const handlers = renderHint();
    // Enter or Space on a button fires a click whose detail is 0.
    fireEvent.click(screen.getByText("Not now"), { detail: 0 });
    expect(handlers.returnFocus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Recap"), { detail: 1 });
    expect(handlers.returnFocus).toHaveBeenCalledTimes(1);
  });

  it("carries no em or en dash", () => {
    renderHint();
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});
