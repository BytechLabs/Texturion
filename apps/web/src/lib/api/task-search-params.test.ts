import { describe, expect, it } from "vitest";

import { taskSearchParams } from "./task-params";
import { toTaskFilters } from "@/components/tasks/task-view-url";
import type { TaskPageState } from "@/components/tasks/task-view-url";

/**
 * Locks in the "All"-tab sentinel plumbing (D25 / TASKS.md T6.1) against the
 * FROZEN /v1/tasks contract (routes/tasks.ts). The /tasks page's All tab, and
 * every whole-set view built on it, must (a) NOT pin an assignee (so the route
 * returns every assignee's rows) and (b) send at least one explicit param so
 * the route does NOT re-apply its Open·Mine default — a bare `/v1/tasks`
 * re-applies status=open + assignee=me and would show only the caller's open
 * tasks. The route keys its "any explicit filter" opt-out off TRUTHY params, so
 * the sentinel must be a real, non-assignee filter. The agreed sentinel is
 * `status=open` (every assignee's open tasks — Done is its own tab).
 *
 * Regression guard: a prior version tried `overdue=false` as the sentinel, but
 * the frozen route reads `overdue` by truthiness (`=== "true"`), so
 * `overdue=false` is NOT an opt-out and All/List fell back to the caller's open
 * tasks only. This asserts the sentinel is a param the route actually honors.
 */

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

describe("taskSearchParams — the All-tab default opt-out sentinel", () => {
  it("List All sends status=open (opts out of Open·Mine) and no assignee", () => {
    const q = query({ view: "list", tab: "all" });
    // status=open is a param the frozen route honors as an explicit filter, so
    // it bypasses the Open·Mine default while returning every assignee's rows.
    expect(q.get("status")).toBe("open");
    expect(q.get("assigned_user_id")).toBeNull();
    // The sentinel is NOT the (ignored) overdue=false.
    expect(q.get("overdue")).toBeNull();
  });

  it("All + a due chip needs no sentinel (due_after/before is the opt-out)", () => {
    // The due-range params are themselves explicit, non-assignee filters, so
    // they opt out on their own — no status sentinel is injected.
    const q = query(
      { view: "list", tab: "all" },
      {
        status: undefined,
        due_after: "2026-07-01T00:00:00.000Z",
        due_before: "2026-07-08T00:00:00.000Z",
      },
    );
    expect(q.get("assigned_user_id")).toBeNull();
    expect(q.get("due_after")).toBe("2026-07-01T00:00:00.000Z");
    // No spurious status filter forced on top of the due range.
    expect(q.get("status")).toBeNull();
  });

  it("Map All uses has_location (its own explicit param) — no redundant sentinel", () => {
    const q = query(
      { view: "map", tab: "all" },
      { status: undefined, has_location: true },
    );
    expect(q.get("has_location")).toBe("true");
    expect(q.get("assigned_user_id")).toBeNull();
    // has_location is already an explicit non-defaulting param, so the sentinel
    // isn't needed (and must not force a spurious status=open predicate).
    expect(q.get("status")).toBeNull();
  });

  it("a real status filter is preserved (the sentinel never clobbers it)", () => {
    const q = query({ view: "list", tab: "all" }, { status: "done" });
    expect(q.get("status")).toBe("done");
    expect(q.get("assigned_user_id")).toBeNull();
  });

  it("All + a specific overdue filter opts out via overdue (no status sentinel)", () => {
    const q = query({ view: "list", tab: "all" }, { overdue: true });
    expect(q.get("overdue")).toBe("true");
    // overdue=true is the explicit opt-out; no redundant status=open injected.
    expect(q.get("status")).toBeNull();
  });

  it("Open / Mine / Done keep their own explicit params (no sentinel needed)", () => {
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
