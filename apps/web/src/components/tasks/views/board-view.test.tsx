/**
 * @vitest-environment happy-dom
 *
 * The Board over the real task hooks and a fake GET /v1/tasks. D25 keeps its
 * two columns: To do is whole, Done is the newest page with "Load more" and a
 * count that does not claim a total it lacks. A card opens the drawer in place,
 * and nothing is dropped onto rows another filter is still replacing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";

type Query = Record<string, string | number | boolean | undefined>;

const { apiFetch, onCardClick } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, options?: { searchParams?: Query }) => Promise<unknown>>(),
  onCardClick: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: { searchParams?: Query }) => apiFetch(path, options),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));
vi.mock("../use-task-mutations", () => ({
  useTaskDone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../task-actions", () => ({
  useTaskRowActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ hrefForTask: (id: string) => `/tasks?task=${id}` }),
  taskLinkClickHandler: (id: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onCardClick(id);
  },
}));

import { BoardView } from "./board-view";

function task(id: string, title: string, done: boolean) {
  return {
    id,
    title,
    done,
    status: done ? "done" : "open",
    message_id: `m-${id}`,
    conversation_id: `c-${id}`,
    labels: [],
    priority: null,
    repeat: null,
    due_at: null,
    assignee_ids: [],
    assigned_user_id: null,
  };
}

let server: { open: unknown[]; done: unknown[] };
let hold: Promise<void> | null = null;

function tasksRequests(status: string): Query[] {
  return apiFetch.mock.calls
    .filter(([path]) => path === "/v1/tasks")
    .map(([, options]) => options?.searchParams ?? {})
    .filter((query) => query.status === status);
}

beforeEach(() => {
  onCardClick.mockReset();
  hold = null;
  server = { open: [task("o1", "Fix sink", false)], done: [] };
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path, options) => {
    if (path !== "/v1/tasks") return { data: [] };
    const query = options?.searchParams ?? {};
    if (hold && query.assigned_user_id === undefined) await hold;
    const rows = query.status === "done" ? server.done : server.open;
    const limit = typeof query.limit === "number" ? query.limit : 25;
    const start = typeof query.cursor === "string" ? Number(query.cursor) : 0;
    const end = start + limit;
    return { data: rows.slice(start, end), next_cursor: end < rows.length ? String(end) : null };
  });
});
afterEach(cleanup);

function renderBoard(state: object) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const view = render(wrap(<BoardView state={state as never} />));
  return {
    ...view,
    rerender: (next: object) => view.rerender(wrap(<BoardView state={next as never} />)),
  };
}

const MINE = { view: "board", tab: "mine" };
const SLOW = { timeout: 20_000 };
const doneColumn = (count: string) =>
  EN.tasks.boardColumnAria.replace("{title}", EN.tasks.boardColumnDone).replace("{count}", count);

describe("Board columns (D25)", () => {
  it("Done is its newest 100 with Load more, counted as 100+ until all are in", async () => {
    server.done = Array.from({ length: 101 }, (_, i) => task(`d${i}`, `done job ${i}`, true));
    renderBoard(MINE);
    await screen.findByText("done job 99", undefined, SLOW);

    expect(tasksRequests("done").map((query) => query.limit)).toEqual([100]);
    expect(tasksRequests("open").map((query) => query.limit)).toEqual([100]);
    expect(screen.getByRole("region", { name: doneColumn("100+") })).toBeTruthy();
    expect(screen.queryByText("done job 100")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: EN.tasks.loadMore }));
    await screen.findByText("done job 100", undefined, SLOW);
    expect(screen.getByRole("region", { name: doneColumn("101") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: EN.tasks.loadMore })).toBeNull();
  });

  it("a card opens the drawer in place and keeps its link", async () => {
    renderBoard(MINE);
    const link = await screen.findByRole("link", { name: /Fix sink/ });
    expect(link.getAttribute("href")).toBe("/tasks?task=o1");
    fireEvent.click(link);
    expect(onCardClick).toHaveBeenCalledWith("o1");
  });

  it("shows the skeleton, not an empty state, while a tab loads behind an empty one", async () => {
    server.open = [];
    const { container, rerender } = renderBoard(MINE);
    await screen.findByText(EN.tasks.emptyMineAny);

    server.open = [task("o1", "Fix sink", false)];
    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    rerender({ view: "board", tab: "all" });
    await waitFor(() => expect(screen.queryByText(EN.tasks.emptyMineAny)).toBeNull());
    expect(screen.queryByText(EN.tasks.emptyTitle)).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();

    release();
    await screen.findByText("Fix sink");
  });

  it("cards cannot be dragged while a changed tab is still loading", async () => {
    const { container, rerender } = renderBoard(MINE);
    await screen.findByText("Fix sink");
    expect(container.querySelector("article")?.getAttribute("draggable")).toBe("true");

    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    rerender({ view: "board", tab: "all" });
    await waitFor(() =>
      expect(container.querySelector("article")?.getAttribute("draggable")).toBe("false"),
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    release();
    await waitFor(() =>
      expect(container.querySelector("article")?.getAttribute("draggable")).toBe("true"),
    );
  });
});
