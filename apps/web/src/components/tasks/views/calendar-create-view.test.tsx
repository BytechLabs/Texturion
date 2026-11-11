/**
 * @vitest-environment happy-dom
 *
 * #739: Enter or a click on an empty calendar cell opens New task prefilled.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openNewTask, tz } = vi.hoisted(() => ({
  openNewTask: vi.fn(),
  tz: { value: "America/Toronto" },
}));

vi.mock("../new-task", () => ({ openNewTask }));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: { timezone: tz.value } }),
}));
vi.mock("@/lib/api/tasks", () => ({
  useAllTasks: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/pagination", () => ({ flattenPages: () => [] }));
vi.mock("../use-task-mutations", () => ({
  useTaskReschedule: () => ({ mutate: vi.fn() }),
}));
vi.mock("../task-actions", () => ({
  useTaskRowActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ hrefForTask: () => "/tasks" }),
}));

import { CalendarView } from "./calendar-view";

const STATE = {
  view: "calendar",
  tab: "all",
  assignee: null,
  due: null,
  q: "",
} as never;

beforeEach(() => {
  openNewTask.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 22:30 on 11 Nov in Toronto, already the 12th in UTC.
  vi.setSystemTime(new Date("2026-11-12T03:30:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("#739 month", () => {
  it("names each weekday once above the grid, not once per week row", () => {
    render(<CalendarView state={STATE} />);
    expect(screen.getAllByText("Sun")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getAllByText("Sun")).toHaveLength(1);
  });

  it("Enter on a focused day opens New task on that day in the workspace zone", () => {
    render(<CalendarView state={STATE} />);
    const cell = screen.getByRole("button", { name: "New task on Thursday, November 12" });
    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(openNewTask).toHaveBeenCalledWith({
      due: "2026-11-12T09:00",
      timeZone: "America/Toronto",
    });
  });

  it("a click opens it too", () => {
    render(<CalendarView state={STATE} />);
    fireEvent.click(screen.getByRole("button", { name: "New task on Wednesday, November 11" }));
    expect(openNewTask).toHaveBeenCalledWith({
      due: "2026-11-11T09:00",
      timeZone: "America/Toronto",
    });
  });

  it("opens on the workspace's today, not the device's", () => {
    tz.value = "America/Los_Angeles";
    render(<CalendarView state={STATE} />);
    // Los Angeles is 19:30 on the 11th: that is the one tab stop.
    const stop = document.querySelector('[data-create-cell][tabindex="0"]');
    expect(stop?.getAttribute("aria-label")).toBe("New task on Wednesday, November 11");
    tz.value = "America/Toronto";
  });
});

describe("#739 week", () => {
  it("Enter on an hour slot opens New task at that day and hour", () => {
    render(<CalendarView state={STATE} />);
    fireEvent.click(screen.getByRole("radio", { name: /week/i }));
    const slot = screen.getByRole("button", { name: "New task on Wednesday, November 11 at 3 PM" });
    fireEvent.keyDown(slot, { key: "Enter" });
    expect(openNewTask).toHaveBeenCalledWith({
      due: "2026-11-11T15:00",
      timeZone: "America/Toronto",
    });
  });

  it("arrow keys move between slots", () => {
    render(<CalendarView state={STATE} />);
    fireEvent.click(screen.getByRole("radio", { name: /week/i }));
    const slot = screen.getByRole("button", { name: "New task on Wednesday, November 11 at 3 PM" });
    slot.focus();
    fireEvent.keyDown(slot, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "New task on Wednesday, November 11 at 4 PM",
    );
  });
});
