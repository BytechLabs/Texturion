/**
 * @vitest-environment happy-dom
 *
 * #752: tasks exist but none has an address. The Map says so and counts them;
 * it never shows "No tasks yet" next to a list that has tasks.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";

const { useAllTasks } = vi.hoisted(() => ({ useAllTasks: vi.fn() }));

vi.mock("@/lib/api/tasks", () => ({
  useAllTasks,
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
  data: { pages: [{ data: rows, has_more: false, next_cursor: null }], pageParams: [] },
});
const pending = { isPending: true, isError: false, isSuccess: false, data: undefined };

/** First call is the located query, the second the unfiltered count. */
function answer(located: unknown, all: unknown) {
  useAllTasks.mockImplementation((filters: { has_location?: boolean }) =>
    filters?.has_location ? located : all,
  );
}

describe("Map view empty states (#752)", () => {
  beforeEach(() => useAllTasks.mockReset());
  afterEach(cleanup);

  it("says none has an address, and how many, when tasks exist", () => {
    answer(page([]), page([{ id: "a" }, { id: "b" }]));
    render(<MapView state={state} />);
    expect(screen.getByText(EN.tasks.mapNoMappedAddress)).toBeTruthy();
    expect(screen.getByText(/2 tasks have no address/)).toBeTruthy();
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
  });

  it("falls back to the plain empty state only when there are no tasks at all", () => {
    answer(page([]), page([]));
    render(<MapView state={state} />);
    expect(screen.getByText(EN.tasks.emptyTitle)).toBeTruthy();
  });

  it("shows no empty state while the count is still loading", () => {
    answer(page([]), pending);
    render(<MapView state={state} />);
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
    expect(screen.queryByText(EN.tasks.mapNoMappedAddress)).toBeNull();
  });
});
