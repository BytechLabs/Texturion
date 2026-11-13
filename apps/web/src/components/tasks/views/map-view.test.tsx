/**
 * @vitest-environment happy-dom
 *
 * #752: tasks exist but none has an address. The Map says so; it never shows
 * "No tasks yet" next to a list that has tasks. Whether any exist is asked
 * with one row, not by downloading every unlocated task to count them.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";

const { useAllTasks, useTasks } = vi.hoisted(() => ({
  useAllTasks: vi.fn(),
  useTasks: vi.fn(),
}));

vi.mock("@/lib/api/tasks", () => ({
  useAllTasks,
  useTasks,
  useGeocodeProgress: () => ({ data: undefined }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../task-empty", () => ({
  EmptyTasks: () => <p>{EN.tasks.emptyTitle}</p>,
}));

import { MapView } from "./map-view";

const state = { tab: "all", chips: {} } as never;
const page = (rows: unknown[]) => ({
  isPending: false,
  isError: false,
  isSuccess: true,
  isPlaceholderData: false,
  data: { pages: [{ data: rows, next_cursor: null }], pageParams: [] },
});
const pending = { isPending: true, isError: false, isSuccess: false, data: undefined };

/** The located drain, then the one-row probe without the location filter. */
function answer(located: unknown, probe: unknown) {
  useAllTasks.mockReturnValue(located);
  useTasks.mockReturnValue(probe);
}

describe("Map view empty states (#752)", () => {
  beforeEach(() => {
    useAllTasks.mockReset();
    useTasks.mockReset();
  });
  afterEach(cleanup);

  it("says none has an address when tasks exist", () => {
    answer(page([]), page([{ id: "a" }]));
    render(<MapView state={state} />);
    expect(screen.getByText(EN.tasks.mapNoMappedAddress)).toBeTruthy();
    expect(screen.getByText(EN.tasks.mapAddAddressHow)).toBeTruthy();
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
  });

  it("asks for one row without the location filter, and only once nothing is located", () => {
    answer(page([]), page([{ id: "a" }]));
    render(<MapView state={state} />);
    const [filters, options] = useTasks.mock.calls[0]!;
    expect(filters).toMatchObject({ limit: 1 });
    expect(filters.has_location).toBeUndefined();
    expect(options).toEqual({ enabled: true });
    expect(useAllTasks.mock.calls[0]![0]).toMatchObject({ has_location: true });
  });

  it("falls back to the plain empty state only when there are no tasks at all", () => {
    answer(page([]), page([]));
    render(<MapView state={state} />);
    expect(screen.getByText(EN.tasks.emptyTitle)).toBeTruthy();
  });

  it("shows no empty state while the probe is still loading", () => {
    answer(page([]), pending);
    render(<MapView state={state} />);
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
    expect(screen.queryByText(EN.tasks.mapNoMappedAddress)).toBeNull();
  });
});
