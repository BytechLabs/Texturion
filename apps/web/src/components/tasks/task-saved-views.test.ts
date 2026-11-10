import { describe, expect, it } from "vitest";

import {
  taskStateToView,
  taskViewMatches,
  viewToTaskState,
} from "./task-saved-views";
import {
  parseTaskSearchParams,
  serializeTaskState,
  toTaskFilters,
  type TaskPageState,
} from "./task-view-url";

const ME = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

const state = (over: Partial<TaskPageState> = {}): TaskPageState => ({
  view: "list",
  tab: "open",
  ...over,
});

describe("a task view holds the query", () => {
  it("stores Open as my open tasks, Mine as me, Done as my done, All as everyone's open", () => {
    expect(taskStateToView(state({ tab: "open" }), ME)).toEqual({
      status: "open",
      assigned_user_id: ME,
    });
    expect(taskStateToView(state({ tab: "mine" }), ME)).toEqual({ assigned_user_id: ME });
    expect(taskStateToView(state({ tab: "done" }), ME)).toEqual({
      status: "done",
      assigned_user_id: ME,
    });
    expect(taskStateToView(state({ tab: "all" }), ME)).toEqual({ status: "open" });
  });

  it("stores the new filters, the sort and the grouping", () => {
    const view = taskStateToView(
      state({
        tab: "all",
        contact: CONTACT,
        createdBy: "me",
        source: "call",
        files: true,
        refs: true,
        sort: "updated",
        group: "assignee",
        priority: ["urgent", "high"],
      }),
      ME,
    );
    expect(view).toEqual({
      status: "open",
      contact_id: CONTACT,
      created_by: "me",
      source: "call",
      has_attachments: true,
      has_references: true,
      sort: "updated",
      group: "assignee",
      priority: "urgent,high",
    });
  });

  it("does not store the search text, the view, or a today chip", () => {
    const view = taskStateToView(state({ tab: "all", q: "furnace", view: "board", due: "today" }), ME);
    expect(view).toEqual({ status: "open" });
  });

  it("stores overdue, and a due range as instants", () => {
    expect(taskStateToView(state({ tab: "all", due: "overdue" }), ME).overdue).toBe(true);
    const range = taskStateToView(state({ tab: "all", dueFrom: "2026-11-02", dueTo: "2026-11-08" }), ME);
    expect(typeof range.due_after).toBe("string");
    expect(typeof range.due_before).toBe("string");
  });

  it("round-trips every tab and filter", () => {
    const cases: TaskPageState[] = [
      state({ tab: "open" }),
      state({ tab: "mine" }),
      state({ tab: "done" }),
      state({ tab: "all" }),
      state({ tab: "all", assignee: SAM }),
      state({ tab: "all", unassigned: true }),
      state({ tab: "all", due: "overdue" }),
      state({ tab: "open", dueFrom: "2026-11-02", dueTo: "2026-11-08" }),
      state({ tab: "all", contact: CONTACT, createdBy: SAM, source: "none", files: true, refs: true }),
      state({ tab: "mine", sort: "priority", group: "priority", priority: ["urgent"] }),
    ];
    for (const original of cases) {
      const back = viewToTaskState(taskStateToView(original, ME), ME, state());
      expect(back).toEqual(original);
    }
  });

  it("keeps the current layout and search when a view is applied", () => {
    const next = viewToTaskState({ status: "open" }, ME, state({ view: "board", tab: "mine", q: "boiler" }));
    expect(next.view).toBe("board");
    expect(next.q).toBe("boiler");
    expect(next.tab).toBe("all");
  });

  it("drops what the allow-list does not know", () => {
    const next = viewToTaskState({ source: "fax", sort: "random", group: "planet" } as never, ME, state());
    expect(next.source).toBeUndefined();
    expect(next.sort).toBeUndefined();
    expect(next.group).toBeUndefined();
  });

  it("knows when the page already shows the view", () => {
    const s = state({ tab: "all", source: "text" });
    expect(taskViewMatches(taskStateToView(s, ME), s, ME)).toBe(true);
    expect(taskViewMatches(taskStateToView(s, ME), state({ tab: "all" }), ME)).toBe(false);
  });
});

describe("the URL carries the new filters", () => {
  it("round-trips them so a view can be shared by link", () => {
    const s = state({
      tab: "all",
      contact: CONTACT,
      createdBy: "me",
      source: "text",
      files: true,
      refs: true,
      dueFrom: "2026-11-02",
      dueTo: "2026-11-08",
      sort: "updated",
      group: "assignee",
    });
    const query = serializeTaskState(s);
    expect(query).toContain("contact=" + CONTACT);
    expect(parseTaskSearchParams(new URLSearchParams(query))).toEqual(s);
  });

  it("ignores bad values", () => {
    const parsed = parseTaskSearchParams(
      new URLSearchParams("contact=nope&by=nope&source=fax&from=tomorrow&group=planet&sort=random"),
    );
    expect(parsed).toEqual({ view: "list", tab: "open" });
  });

  it("maps to the list request", () => {
    const filters = toTaskFilters(
      state({
        tab: "all",
        contact: CONTACT,
        createdBy: "me",
        source: "call",
        files: true,
        refs: true,
        dueFrom: "2026-11-02",
        dueTo: "2026-11-08",
      }),
    );
    expect(filters).toMatchObject({
      contact_id: CONTACT,
      created_by: "me",
      source: "call",
      has_attachments: true,
      has_references: true,
    });
    expect(new Date(filters.due_before as string).getTime()).toBeGreaterThan(
      new Date(filters.due_after as string).getTime(),
    );
  });
});
