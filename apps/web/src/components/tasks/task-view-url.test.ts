import { describe, expect, it } from "vitest";

import {
  hasActiveChips,
  parseTaskSearchParams,
  parseView,
  serializeTaskState,
  toTaskFilters,
  type TaskPageState,
} from "./task-view-url";

describe("parseView", () => {
  it("defaults unknown / missing to list", () => {
    expect(parseView(null)).toBe("list");
    expect(parseView("nonsense")).toBe("list");
  });
  it("accepts the four valid views", () => {
    expect(parseView("board")).toBe("board");
    expect(parseView("calendar")).toBe("calendar");
    expect(parseView("map")).toBe("map");
    expect(parseView("list")).toBe("list");
  });
});

describe("parseTaskSearchParams", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseTaskSearchParams(new URLSearchParams())).toEqual({
      view: "list",
      tab: "open",
    });
  });

  it("parses every dimension and drops unknowns", () => {
    const params = new URLSearchParams(
      "view=board&tab=all&assignee=u1&due=today&q=fix&unknown=x",
    );
    expect(parseTaskSearchParams(params)).toEqual({
      view: "board",
      tab: "all",
      assignee: "u1",
      due: "today",
      q: "fix",
    });
  });

  it("accepts both unassigned=1 and unassigned=true", () => {
    expect(parseTaskSearchParams(new URLSearchParams("unassigned=1")).unassigned).toBe(true);
    expect(parseTaskSearchParams(new URLSearchParams("unassigned=true")).unassigned).toBe(true);
  });

  it("ignores blank q and invalid due", () => {
    const params = new URLSearchParams("q=%20%20&due=nope");
    const state = parseTaskSearchParams(params);
    expect(state.q).toBeUndefined();
    expect(state.due).toBeUndefined();
  });
});

describe("serializeTaskState round-trips", () => {
  it("omits defaults (list + open) for a clean URL", () => {
    expect(serializeTaskState({ view: "list", tab: "open" })).toBe("");
  });

  it("is a stable inverse of parse", () => {
    const state: TaskPageState = {
      view: "calendar",
      tab: "all",
      assignee: "u9",
      due: "overdue",
      q: "roof",
    };
    const round = parseTaskSearchParams(
      new URLSearchParams(serializeTaskState(state).slice(1)),
    );
    expect(round).toEqual(state);
  });
});

describe("toTaskFilters", () => {
  it("Open tab → status open, assignee me", () => {
    expect(toTaskFilters({ view: "list", tab: "open" })).toEqual({
      status: "open",
      assigned_user_id: "me",
    });
  });

  it("Mine tab → assignee me, no status", () => {
    expect(toTaskFilters({ view: "list", tab: "mine" })).toEqual({
      assigned_user_id: "me",
    });
  });

  it("Done tab → status done, assignee me", () => {
    expect(toTaskFilters({ view: "list", tab: "done" })).toEqual({
      status: "done",
      assigned_user_id: "me",
    });
  });

  it("All tab → the `all` escape-hatch assignee (no default re-apply)", () => {
    expect(toTaskFilters({ view: "list", tab: "all" })).toEqual({
      assigned_user_id: "all",
    });
  });

  it("a specific-member assignee chip overrides the tab baseline", () => {
    const filters = toTaskFilters({ view: "list", tab: "open", assignee: "u5" });
    expect(filters.assigned_user_id).toBe("u5");
    expect(filters.status).toBe("open");
  });

  it("the unassigned chip clears the assignee and sets unassigned", () => {
    const filters = toTaskFilters({ view: "list", tab: "all", unassigned: true });
    expect(filters.assigned_user_id).toBeUndefined();
    expect(filters.unassigned).toBe(true);
  });

  it("the overdue due chip sets overdue=true", () => {
    const filters = toTaskFilters({ view: "list", tab: "open", due: "overdue" });
    expect(filters.overdue).toBe(true);
  });

  it("the today due chip sets a one-day ISO window", () => {
    const now = new Date("2026-07-03T15:00:00Z");
    const filters = toTaskFilters({ view: "list", tab: "all", due: "today" }, now);
    expect(filters.due_after).toBeDefined();
    expect(filters.due_before).toBeDefined();
    // The window spans exactly one calendar day in local time.
    const after = new Date(filters.due_after!);
    const before = new Date(filters.due_before!);
    expect(before.getTime() - after.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("the week due chip sets a seven-day window", () => {
    const now = new Date("2026-07-03T15:00:00Z");
    const filters = toTaskFilters({ view: "list", tab: "all", due: "week" }, now);
    const after = new Date(filters.due_after!);
    const before = new Date(filters.due_before!);
    expect(before.getTime() - after.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("hasActiveChips", () => {
  it("is false for a bare tab view", () => {
    expect(hasActiveChips({ view: "list", tab: "open" })).toBe(false);
  });
  it("is true when any chip is set", () => {
    expect(hasActiveChips({ view: "list", tab: "open", due: "overdue" })).toBe(true);
    expect(hasActiveChips({ view: "list", tab: "all", assignee: "u1" })).toBe(true);
    expect(hasActiveChips({ view: "list", tab: "all", unassigned: true })).toBe(true);
    expect(hasActiveChips({ view: "list", tab: "all", q: "x" })).toBe(true);
  });
});
