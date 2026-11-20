/**
 * @vitest-environment happy-dom
 *
 * What the Calendar asks for, over the real task hooks and a fake GET
 * /v1/tasks: one read per month grid, which Week slices instead of asking
 * again; none until the workspace clock is known; and a month step keeps the
 * chips it still has while the next month loads.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";
import { CalendarView } from "./calendar-view";

type Query = Record<string, string | number | boolean | undefined>;

const { apiFetch, company, onChipClick } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, options?: { searchParams?: Query }) => Promise<unknown>>(),
  company: {
    current: {} as { data?: { timezone: string }; isSuccess: boolean; isError: boolean },
  },
  onChipClick: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: { searchParams?: Query }) => apiFetch(path, options),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => company.current }));
vi.mock("../new-task", () => ({ openNewTask: vi.fn() }));
vi.mock("../use-task-mutations", () => ({
  useTaskReschedule: () => ({ mutate: vi.fn() }),
}));
vi.mock("../task-actions", () => ({
  useTaskRowActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ hrefForTask: (id: string) => `/tasks?task=${id}` }),
  taskLinkClickHandler: (id: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onChipClick(id);
  },
}));


const LOADED = { data: { timezone: "America/Toronto" }, isSuccess: true, isError: false };
const STATE = { view: "calendar", tab: "all" };

/** Due 2 December, inside both the November grid (to 5 Dec) and December's. */
const overlapTask = {
  id: "t-dec",
  title: "Service the furnace",
  done: false,
  status: "open",
  message_id: "m1",
  conversation_id: "conv-1",
  labels: [],
  priority: null,
  repeat: null,
  due_at: "2026-12-02T15:00:00.000Z",
};

let hold: Promise<void> | null = null;

function tasksRequests(): Query[] {
  return apiFetch.mock.calls
    .filter(([path, options]) => path === "/v1/tasks" && !options?.searchParams?.calendar_undated)
    .map(([, options]) => options?.searchParams ?? {});
}

function renderCalendar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const view = render(wrap(<CalendarView state={STATE as never} />));
  return { ...view, rerender: () => view.rerender(wrap(<CalendarView state={STATE as never} />)) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  company.current = LOADED;
  hold = null;
  onChipClick.mockReset();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path, options) => {
    if (path !== "/v1/tasks") return { data: [] };
    const query = options?.searchParams ?? {};
    // Only December's grid starts on 29 November.
    if (hold && String(query.due_after).startsWith("2026-11-29")) await hold;
    return { data: [overlapTask], next_cursor: null };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Calendar reads", () => {
  it("Week and a week step inside the month reuse the month's read", async () => {
    renderCalendar();
    await waitFor(() => expect(tasksRequests()).toHaveLength(2));
    expect(tasksRequests()[0]).toMatchObject({ limit: 100 });

    fireEvent.click(screen.getByRole("radio", { name: EN.tasks.calendarRangeWeek }));
    fireEvent.click(screen.getByRole("button", { name: EN.tasks.calendarNextWeek }));
    await act(() => Promise.resolve());
    expect(tasksRequests()).toHaveLength(2);
  });

  it("waits for the workspace clock before the first read", async () => {
    company.current = { isSuccess: false, isError: false };
    const { rerender } = renderCalendar();
    await act(() => Promise.resolve());
    expect(tasksRequests()).toHaveLength(0);

    company.current = LOADED;
    rerender();
    await waitFor(() => expect(tasksRequests()).toHaveLength(2));
    // Midnight on Sunday 1 November in Toronto.
    const expected = "2026-11-01T04:00:00.000Z";
    expect(tasksRequests().find((query) => query.due_after)?.due_after).toBe(expected);
    expect(tasksRequests().find((query) => query.schedule_after)?.schedule_after).toBe(expected);
  });

  it("does not say the next month is empty while it loads", async () => {
    apiFetch.mockImplementation(async (path, options) => {
      if (path !== "/v1/tasks") return { data: [] };
      if (hold && String(options?.searchParams?.due_after).startsWith("2026-11-29")) await hold;
      return { data: [], next_cursor: null };
    });
    renderCalendar();
    await screen.findByText(EN.tasks.calendarEmptyDueDate);

    let release = () => {};
    hold = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole("button", { name: EN.tasks.calendarNextMonth }));
    await waitFor(() => expect(tasksRequests()).toHaveLength(4));
    expect(screen.queryByText(EN.tasks.calendarEmptyDueDate)).toBeNull();

    release();
    await screen.findByText(EN.tasks.calendarEmptyDueDate);
  });

  it("shows both published bookings even when their task is due outside this month", async () => {
    apiFetch.mockImplementation(async (_path, options) => ({
      data: options?.searchParams?.schedule_after ? [{
        ...overlapTask,
        due_at: "2026-12-14T15:00:00.000Z",
        published_work: [
          { id: "visit-1", starts_at: "2026-11-12T15:00:00Z", ends_at: "2026-11-12T15:40:00Z" },
          { id: "visit-2", starts_at: "2026-11-12T19:00:00Z", ends_at: "2026-11-12T19:40:00Z" },
        ],
      }] : [],
      next_cursor: null,
    }));
    renderCalendar();
    const visits = await screen.findAllByRole("link", { name: /Service the furnace/ });
    expect(visits).toHaveLength(2);
    expect(visits[0].textContent).toContain("10:00");
    expect(visits[1].textContent).toContain("2:00");
  });

  it("a month step keeps the chips it still shows while the next month loads", async () => {
    const { container } = renderCalendar();
    const chip = await screen.findByRole("link", { name: "Service the furnace" });
    fireEvent.click(chip);
    expect(onChipClick).toHaveBeenCalledWith("t-dec");

    let release = () => {};
    hold = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByRole("button", { name: EN.tasks.calendarNextMonth }));
    await waitFor(() => expect(tasksRequests()).toHaveLength(4));
    expect(screen.getByRole("link", { name: "Service the furnace" })).toBeInstanceOf(Element);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    release();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByRole("link", { name: "Service the furnace" })).toBeInstanceOf(Element);
  });
});
