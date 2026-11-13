// @vitest-environment happy-dom
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { taskLinkClickHandler, useTaskDrawer } from "./use-task-drawer";

afterEach(cleanup);

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

describe("useTaskDrawer", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/tasks?view=board");
  });

  it("opens a task as a new history entry, without the router", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useTaskDrawer());
    result.current.openTask("t-1");
    expect(push).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe("/tasks?view=board&task=t-1");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("closes by replacing the entry and keeps the other params", () => {
    window.history.replaceState(null, "", "/tasks?view=board&task=t-1");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useTaskDrawer());
    result.current.closeTask();
    expect(currentUrl()).toBe("/tasks?view=board");
    expect(push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("builds the task href on the current URL", () => {
    const { result } = renderHook(() => useTaskDrawer());
    expect(result.current.hrefForTask("t-9")).toBe("/tasks?view=board&task=t-9");
  });
});

describe("taskLinkClickHandler", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/tasks?view=calendar");
  });

  function renderLink(target?: string) {
    render(
      <Link
        href="/tasks?view=calendar&task=t-3"
        target={target}
        onClick={taskLinkClickHandler("t-3")}
      >
        Fix the roof
      </Link>,
    );
    return screen.getByText("Fix the roof");
  }

  /** Clicks, then stops the browser's own navigation so the test page stays put. */
  function click(link: HTMLElement, init: MouseEventInit) {
    const push = vi.spyOn(window.history, "pushState");
    let prevented = false;
    const settle = (event: Event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", settle);
    fireEvent.click(link, init);
    window.removeEventListener("click", settle);
    return { prevented, pushed: push.mock.calls.length };
  }

  it("opens the drawer in place on a plain click", () => {
    expect(click(renderLink(), { button: 0 })).toEqual({ prevented: true, pushed: 1 });
    expect(currentUrl()).toBe("/tasks?view=calendar&task=t-3");
  });

  it.each<[string, MouseEventInit]>([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
  ])("leaves a %s click to the browser", (_name, modifier) => {
    expect(click(renderLink(), { button: 0, ...modifier })).toEqual({
      prevented: false,
      pushed: 0,
    });
  });

  it("leaves a link that opens elsewhere to the browser", () => {
    expect(click(renderLink("_blank"), { button: 0 })).toEqual({
      prevented: false,
      pushed: 0,
    });
  });
});
