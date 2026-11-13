/**
 * @vitest-environment happy-dom
 *
 * Opening a task: its links, activity and timeline are asked for beside the
 * detail rather than after it, and while the detail loads the header is the
 * list row it was opened from, with nothing to edit and nothing from the
 * conversation (#107: viewer_level is not known yet).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/lib/api/keys";

const { apiFetch, rowLookups } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string) => Promise<unknown>>(),
  rowLookups: { count: 0 },
}));

vi.mock("@/lib/api/client", () => ({ apiFetch: (path: string) => apiFetch(path) }));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));
// Counts the panel's own renders while the detail is pending.
vi.mock("@/lib/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tasks")>();
  return {
    ...actual,
    findCachedTaskRow: (...args: Parameters<typeof actual.findCachedTaskRow>) => {
      rowLookups.count += 1;
      return actual.findCachedTaskRow(...args);
    },
  };
});

import { TaskDetailPanel } from "./task-detail-panel";

const row = {
  id: "t1",
  title: "Fix the kitchen sink",
  done: false,
  status: "open",
  message_id: "m1",
  conversation_id: "conv-1",
  labels: [],
  priority: null,
  repeat: null,
  due_at: null,
};

function renderPanel(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return render(
    <QueryClientProvider client={client}>
      <TaskDetailPanel taskId="t1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  // Nothing answers, so the panel stays where a slow detail leaves it.
  apiFetch.mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

describe("TaskDetailPanel while the detail loads", () => {
  it("asks for the links, the activity and the timeline beside the detail", async () => {
    renderPanel();
    await waitFor(() =>
      expect(apiFetch.mock.calls.map(([path]) => path).sort()).toEqual([
        "/v1/tasks/t1",
        "/v1/tasks/t1/activity",
        "/v1/tasks/t1/links",
        "/v1/tasks/t1/record-activity",
      ]),
    );
  });

  it("does not re-render when the activity answers first", async () => {
    let answerActivity = () => {};
    apiFetch.mockImplementation((path) =>
      path === "/v1/tasks/t1/activity"
        ? new Promise((resolve) => {
            answerActivity = () => resolve({ data: [], next_cursor: null });
          })
        : new Promise(() => {}),
    );
    let client!: QueryClient;
    renderPanel((seeded) => {
      client = seeded;
    });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));
    const before = rowLookups.count;

    answerActivity();
    await waitFor(() =>
      expect(client.getQueryState(keys.tasks.activity("c-1", "t1"))?.status).toBe("success"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rowLookups.count).toBe(before);
  });

  it("paints the header from a cached list row, with nothing to edit", () => {
    const { container } = renderPanel((client) =>
      client.setQueryData(keys.tasks.list("c-1", { status: "open" }), {
        pages: [{ data: [row], next_cursor: null }],
        pageParams: [undefined],
      }),
    );
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
    expect(container.querySelector("textarea, input, button, a")).toBeNull();
  });

  it("is the plain skeleton when no list holds the task", () => {
    const { container } = renderPanel();
    expect(screen.queryByText("Fix the kitchen sink")).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
