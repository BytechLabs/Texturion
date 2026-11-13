/**
 * @vitest-environment happy-dom
 *
 * The List view over the real task hooks and a fake GET /v1/tasks:
 * #743: a list row carries one checkbox (it selects) and the Status cell is
 * the control for changing status. The pinned tabs page on request, the
 * statusless tabs drain open at 100 a page and page done, a changed filter
 * keeps its rows until the new answer lands, and a row warms its detail.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";

type Query = Record<string, string | number | boolean | undefined>;

const { apiFetch, mutate, undoToast } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, options?: { searchParams?: Query }) => Promise<unknown>>(),
  mutate: vi.fn(),
  undoToast: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: { searchParams?: Query }) => apiFetch(path, options),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));
vi.mock("@/lib/hooks/use-records-delete", () => ({ useCanDeleteRecords: () => false }));
vi.mock("../use-task-mutations", () => ({
  useTaskDone: () => ({ mutate, isPending: false }),
}));
vi.mock("../task-actions", () => ({
  useTaskRowActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("../task-inline-edit", () => ({
  InlineAssignee: () => null,
  InlineDue: () => null,
}));
vi.mock("../use-task-drawer", () => ({
  useTaskDrawer: () => ({ openTask: vi.fn(), hrefForTask: () => "/" }),
}));
vi.mock("@/lib/use-is-xl", () => ({ useIsXl: () => true }));
vi.mock("@/components/ui/optimistic-undo", () => ({ undoableToast: undoToast }));

import { ListView } from "./list-view";

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
  };
}

function many(prefix: string, count: number, done: boolean) {
  return Array.from({ length: count }, (_, i) => task(`${prefix}${i}`, `${prefix} job ${i}`, done));
}

/** What the fake route holds, by status, and a gate a test can hold a status behind. */
let server: { open: unknown[]; done: unknown[] };
let hold: { status: string; release: Promise<void> } | null = null;

function tasksRequests(status?: string): Query[] {
  return apiFetch.mock.calls
    .filter(([path]) => path === "/v1/tasks")
    .map(([, options]) => options?.searchParams ?? {})
    .filter((query) => status === undefined || query.status === status);
}

beforeEach(() => {
  mutate.mockReset();
  undoToast.mockReset();
  hold = null;
  server = { open: [], done: [] };
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path, options) => {
    if (path !== "/v1/tasks") return path.startsWith("/v1/tasks/") ? { id: path } : { data: [] };
    const query = options?.searchParams ?? {};
    const status = query.status === "done" ? "done" : "open";
    if (hold?.status === status) await hold.release;
    const rows = server[status];
    const limit = typeof query.limit === "number" ? query.limit : 25;
    const start = typeof query.cursor === "string" ? Number(query.cursor) : 0;
    const end = start + limit;
    return {
      data: rows.slice(start, end),
      next_cursor: end < rows.length ? String(end) : null,
    };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderList(state: object) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const view = render(wrap(<ListView state={state as never} />));
  return {
    rerender: (next: object) => view.rerender(wrap(<ListView state={next as never} />)),
    container: view.container,
  };
}

/** A couple of hundred rows take a while to render on a slow machine. */
const SLOW = { timeout: 20_000 };

const MINE = { view: "list", tab: "mine" };
const OPEN = { view: "list", tab: "open" };
const DONE = { view: "list", tab: "done" };

describe("Tasks list status control (#743)", () => {
  beforeEach(() => {
    server = { open: [task("t1", "Call Ana", false)], done: [task("t2", "Send quote", true)] };
  });

  it("renders exactly one checkbox per row, and it selects", async () => {
    const { container } = renderList(MINE);
    await screen.findByText("Send quote");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    for (const li of items) {
      const boxes = li.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
      expect(boxes.length).toBe(1);
      expect(boxes[0].getAttribute("aria-label")).toMatch(/^Select /);
    }
    expect(screen.queryByRole("checkbox", { name: /mark (not )?done/i })).toBeNull();
  });

  it("changes status from the Status cell and offers Undo", async () => {
    renderList(MINE);
    const trigger = (await screen.findAllByRole("button", { name: /Status of Call Ana: Open/ }))[0];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Done" }));
    expect(mutate).toHaveBeenCalledWith({
      taskId: "t1",
      messageId: "m-t1",
      conversationId: "c-t1",
      done: true,
    });
    expect(undoToast).toHaveBeenCalledOnce();
    undoToast.mock.calls[0][0].onUndo();
    expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "t1", done: false }));
  });

  it("reopens a done task, and is reachable by keyboard", async () => {
    renderList(MINE);
    const trigger = (await screen.findAllByRole("button", { name: /Status of Send quote: Done/ }))[0];
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const open = screen.getByRole("menuitemradio", { name: "Open" });
    expect(screen.getByRole("menuitemradio", { name: "Done" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(open);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t2", done: false }));
  });

  it("does nothing when the current status is picked again", async () => {
    renderList(MINE);
    const trigger = (await screen.findAllByRole("button", { name: /Status of Call Ana/ }))[0];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Open" }));
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("what the List asks for", () => {
  it("a pinned tab reads one page and waits for Load more", async () => {
    server.open = many("o", 30, false);
    renderList(OPEN);
    await screen.findByText("o job 0");
    // A second read here would be a page nobody asked for.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(tasksRequests()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: EN.tasks.loadMore }));
    await screen.findByText("o job 29");
    expect(tasksRequests()).toHaveLength(2);
  });

  it("Mine drains open at 100 a page and reads one page of done", async () => {
    server.open = many("o", 101, false);
    server.done = many("d", 101, true);
    renderList(MINE);
    await screen.findByText("o job 100", undefined, SLOW);
    await screen.findByText("d job 99", undefined, SLOW);

    expect(tasksRequests("open").map((query) => query.limit)).toEqual([100, 100]);
    expect(tasksRequests("done").map((query) => query.limit)).toEqual([100]);
    expect(screen.queryByText("d job 100")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: EN.tasks.loadMore }));
    await screen.findByText("d job 100", undefined, SLOW);
    expect(tasksRequests("done")).toHaveLength(2);
  });

  it("offers every matching task while done has more pages", async () => {
    server.open = many("o", 1, false);
    server.done = many("d", 101, true);
    renderList(MINE);
    await screen.findByText("d job 99", undefined, SLOW);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select o job 0" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: EN.tasks.bulkSelectThese.replace("{count}", "101"),
      }),
    );
    expect(screen.getByRole("button", { name: EN.tasks.bulkSelectAllMatching })).toBeTruthy();
  });

  it("keeps the last rows, dimmed and busy, while a changed tab loads", async () => {
    server.open = [task("t1", "Call Ana", false)];
    server.done = [task("t2", "Send quote", true)];
    const { rerender, container } = renderList(OPEN);
    await screen.findByText("Call Ana");

    let release = () => {};
    hold = { status: "done", release: new Promise<void>((resolve) => (release = resolve)) };
    rerender(DONE);
    await waitFor(() => expect(tasksRequests("done")).toHaveLength(1));
    expect(screen.getByText("Call Ana")).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    release();
    await screen.findByText("Send quote");
    expect(screen.queryByText("Call Ana")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("shows the skeleton, not an empty state, while a tab loads behind an empty one", async () => {
    server.done = [task("t2", "Send quote", true)];
    const { rerender, container } = renderList(OPEN);
    await screen.findByText(EN.tasks.emptyMine);

    let release = () => {};
    hold = { status: "done", release: new Promise<void>((resolve) => (release = resolve)) };
    rerender(DONE);
    await waitFor(() => expect(tasksRequests("done")).toHaveLength(1));
    expect(screen.queryByText(EN.tasks.emptyMineDone)).toBeNull();
    expect(screen.queryByText(EN.tasks.emptyMine)).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();

    release();
    await screen.findByText("Send quote");
  });

  it("does not offer every matching task under a search the bulk route cannot apply", async () => {
    server.open = many("o", 1, false);
    server.done = many("d", 101, true);
    renderList({ ...MINE, q: "job" });
    await screen.findByText("d job 99", undefined, SLOW);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select o job 0" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: EN.tasks.bulkSelectThese.replace("{count}", "101"),
      }),
    );
    expect(screen.queryByRole("button", { name: EN.tasks.bulkSelectAllMatching })).toBeNull();
  });

  it("warms a task's detail on focus and on a resting pointer, not on a pass", async () => {
    server.open = [task("t1", "Call Ana", false), task("t3", "Fix sink", false)];
    const { container } = renderList(OPEN);
    const title = await screen.findByRole("button", { name: "Call Ana" });
    const detailReads = () =>
      apiFetch.mock.calls.map(([path]) => path).filter((path) => path.startsWith("/v1/tasks/"));

    fireEvent.focusIn(title);
    await waitFor(() => expect(detailReads()).toEqual(["/v1/tasks/t1"]));

    vi.useFakeTimers();
    const rows = container.querySelectorAll("li > div");
    fireEvent.pointerEnter(rows[1]!);
    fireEvent.pointerLeave(rows[1]!);
    await vi.advanceTimersByTimeAsync(200);
    expect(detailReads()).toEqual(["/v1/tasks/t1"]);

    fireEvent.pointerEnter(rows[1]!);
    await vi.advanceTimersByTimeAsync(99);
    expect(detailReads()).toEqual(["/v1/tasks/t1"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(detailReads()).toEqual(["/v1/tasks/t1", "/v1/tasks/t3"]);
  });
});
