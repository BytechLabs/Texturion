import { describe, expect, it } from "vitest";

import { taskListKeyFilters, taskSearchParams } from "./task-params";
import { toTaskFilters } from "@/components/tasks/task-view-url";
import type { TaskPageState } from "@/components/tasks/task-view-url";

/** The request query the client would send for a given page state (+ merge). */
function query(
  state: TaskPageState,
  merge: Partial<ReturnType<typeof toTaskFilters>> = {},
): URLSearchParams {
  const params = taskSearchParams(
    { ...toTaskFilters(state), ...merge },
    undefined,
  );
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out.set(k, String(v));
  }
  return out;
}

describe("taskSearchParams task scope", () => {
  it("All tasks includes both statuses across assignees", () => {
    const q = query({ view: "list", tab: "all" });
    expect(q.get("status")).toBeNull();
    expect(q.get("assigned_user_id")).toBe("all");
    expect(q.get("overdue")).toBeNull();
  });

  it("keeps both statuses when narrowing by due date", () => {
    const q = query(
      { view: "list", tab: "all" },
      {
        status: undefined,
        due_after: "2026-07-01T00:00:00.000Z",
        due_before: "2026-07-08T00:00:00.000Z",
      },
    );
    expect(q.get("assigned_user_id")).toBe("all");
    expect(q.get("due_after")).toBe("2026-07-01T00:00:00.000Z");
    expect(q.get("status")).toBeNull();
  });

  it("keeps both statuses when requesting map locations", () => {
    const q = query(
      { view: "map", tab: "all" },
      { status: undefined, has_location: true },
    );
    expect(q.get("has_location")).toBe("true");
    expect(q.get("assigned_user_id")).toBe("all");
    expect(q.get("status")).toBeNull();
  });

  it("honors an explicit status across all assignees", () => {
    const q = query({ view: "list", tab: "all" }, { status: "done" });
    expect(q.get("status")).toBe("done");
    expect(q.get("assigned_user_id")).toBe("all");
  });

  it("sends the overdue selection without an extra status filter", () => {
    const q = query({ view: "list", tab: "all" }, { overdue: true });
    expect(q.get("overdue")).toBe("true");
    expect(q.get("status")).toBeNull();
  });

  it("keeps the scope of old Open, Mine and Done links", () => {
    const open = query({ view: "list", tab: "open" });
    expect(open.get("status")).toBe("open");
    expect(open.get("assigned_user_id")).toBe("me");
    expect(open.get("overdue")).toBeNull();

    const mine = query({ view: "list", tab: "mine" });
    expect(mine.get("assigned_user_id")).toBe("me");
    expect(mine.get("status")).toBeNull();
    expect(mine.get("overdue")).toBeNull();

    const done = query({ view: "list", tab: "done" });
    expect(done.get("status")).toBe("done");
    expect(done.get("assigned_user_id")).toBe("me");
    expect(done.get("overdue")).toBeNull();
  });
});

describe("#693 priority, label and sort query params", () => {
  it("sends the priority list, the tag and a non-default sort", () => {
    const q = query({
      view: "list",
      tab: "open",
      priority: ["urgent", "high"],
      tag: "tag-1",
      sort: "priority",
    });
    expect(q.get("priority")).toBe("urgent,high");
    expect(q.get("tag_id")).toBe("tag-1");
    expect(q.get("sort")).toBe("priority");
  });

  it("sends none of them when unset", () => {
    const q = query({ view: "list", tab: "open" });
    expect(q.has("priority")).toBe(false);
    expect(q.has("tag_id")).toBe(false);
    expect(q.has("sort")).toBe(false);
  });
});

describe("the page size", () => {
  it("is sent when asked for and left to the route otherwise", () => {
    expect(taskSearchParams({ status: "open", limit: 100 }, "c1")).toMatchObject({
      limit: 100,
      cursor: "c1",
    });
    expect(taskSearchParams({ status: "open" }, undefined).limit).toBeUndefined();
  });
});

describe("taskListKeyFilters: equal requests share one cache entry", () => {
  it("drops what the request never sends", () => {
    expect(
      taskListKeyFilters({
        assigned_user_id: "me",
        status: undefined,
        overdue: undefined,
        unassigned: false,
        priority: [],
      }),
    ).toEqual({ assigned_user_id: "me" });
  });

  it("keeps every value that changes the answer, the page size included", () => {
    const request = {
      assigned_user_id: "all",
      status: "done" as const,
      priority: ["urgent" as const],
      has_location: true,
      scheduled: false,
      limit: 1,
    };
    expect(taskListKeyFilters(request)).toEqual(request);
  });
});
