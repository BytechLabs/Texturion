/**
 * @vitest-environment happy-dom
 *
 * Deleting the task on /tasks/[id] goes back to /tasks in the app, not by
 * reloading it, and the deleted task's cached detail goes once the page does.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/lib/api/keys";

const { replace, panel } = vi.hoisted(() => ({
  replace: vi.fn(),
  panel: { onClose: undefined as (() => void) | undefined },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("./task-detail-panel", () => ({
  TaskDetailPanel: ({ onClose }: { onClose?: () => void }) => {
    panel.onClose = onClose;
    return null;
  },
}));

import { TaskRoutePanel } from "./task-route-panel";

afterEach(cleanup);

describe("TaskRoutePanel after a delete", () => {
  it("replaces to /tasks and drops the detail when the page goes", () => {
    const client = new QueryClient();
    client.setQueryData(keys.tasks.detail("c-1", "t1"), { id: "t1" });
    client.setQueryData(keys.tasks.detail("c-1", "t2"), { id: "t2" });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const view = render(
      <QueryClientProvider client={client}>
        <TaskRoutePanel taskId="t1" />
      </QueryClientProvider>,
    );

    act(() => panel.onClose?.());
    expect(replace).toHaveBeenCalledWith("/tasks");
    expect(assign).not.toHaveBeenCalled();
    // Still on screen until the navigation lands, so nothing refetches it.
    expect(client.getQueryData(keys.tasks.detail("c-1", "t1"))).toBeDefined();

    view.unmount();
    expect(client.getQueryData(keys.tasks.detail("c-1", "t1"))).toBeUndefined();
    expect(client.getQueryData(keys.tasks.detail("c-1", "t2"))).toBeDefined();
  });
});
