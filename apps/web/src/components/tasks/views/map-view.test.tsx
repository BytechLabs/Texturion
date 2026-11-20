/**
 * @vitest-environment happy-dom
 *
 * #752: tasks exist but none has a map pin. The Map says so; it never shows
 * "No tasks yet" next to a list that has tasks. Whether any exist is asked
 * with one row, not by downloading every unlocated task to count them.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";
import type { TaskPageState } from "../task-view-url";
import { MapView } from "./map-view";

const { useAllTasks, useTasks } = vi.hoisted(() => ({
  useAllTasks: vi.fn(),
  useTasks: vi.fn(),
}));

vi.mock("@/lib/api/tasks", () => ({
  useAllTasks,
  useTasks,
}));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => ({ data: { timezone: "UTC" } }) }));
vi.mock("next/dynamic", () => ({
  default: () => function MapFixture({ tasks }: { tasks: { id: string }[] }) {
    return <div>{tasks.map(({ id }) => <span key={id}>{id}</span>)}</div>;
  },
}));
vi.mock("../task-empty", () => ({
  EmptyTasks: () => <p>{EN.tasks.emptyTitle}</p>,
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ hrefForTask: (id: string) => `/tasks?task=${id}` }),
}));


const state: TaskPageState = { view: "map", tab: "all" };
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

  it("explains the pause and announces zero map matches for unlocated tasks", async () => {
    answer(page([]), page([{ id: "a", due_at: new Date().toISOString() }]));
    render(<MapView state={{ ...state, q: "inspection" }} />);
    expect(screen.getByText(EN.tasks.mapNoMappedAddress)).toBeInstanceOf(Element);
    expect(screen.getByText(EN.tasks.mapAddressLookupPaused)).toBeInstanceOf(Element);
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        EN.shell.resultsShown.replace("{count}", "0").replace("{query}", "inspection"),
      );
    });
  });

  it("keeps existing pins visible during the pause", () => {
    answer(page([{
      id: "existing-pin", title: "Known address", due_at: new Date().toISOString(), lat: 49.28, lng: -123.12,
    }]), page([]));
    render(<MapView state={state} />);
    expect(screen.getByText("existing-pin")).toBeInstanceOf(Element);
    expect(screen.getByText(EN.tasks.mapAddressLookupPaused)).toBeInstanceOf(Element);
  });

  it("counts tasks without the location filter for the same booking date", () => {
    answer(page([]), page([{ id: "a" }]));
    render(<MapView state={state} />);
    const [[filters]] = useTasks.mock.calls;
    expect(filters).toMatchObject({ limit: 1, include_count: true });
    expect(filters.has_location).toBeUndefined();
    const [[mapped]] = useAllTasks.mock.calls;
    expect(mapped).toMatchObject({ has_location: true, schedule_after: filters.schedule_after, schedule_before: filters.schedule_before });
  });

  it("keeps customer, creator and source filters when opening the map from a filtered list", () => {
    answer(page([]), page([]));
    render(<MapView state={{ ...state, contact: "customer", createdBy: "me", source: "call", files: true, refs: true }} />);

    expect(useAllTasks.mock.calls[0][0]).toMatchObject({
      contact_id: "customer", created_by: "me", source: "call",
      has_attachments: undefined, has_references: undefined,
    });
  });

  it("falls back to the plain empty state only when there are no tasks at all", () => {
    answer(page([]), page([]));
    render(<MapView state={state} />);
    expect(screen.getByText(EN.tasks.emptyTitle)).toBeInstanceOf(Element);
  });

  it("shows no empty state while the probe is still loading", () => {
    answer(page([]), pending);
    render(<MapView state={state} />);
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
    expect(screen.queryByText(EN.tasks.mapNoMappedAddress)).toBeNull();
  });
});
