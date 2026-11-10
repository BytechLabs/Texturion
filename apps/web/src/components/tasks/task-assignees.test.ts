import { describe, expect, it } from "vitest";

import {
  assigneeNames,
  isAssignedTo,
  MAX_ASSIGNEES,
  sameCrew,
  taskAssigneeIds,
  toggleAssignee,
} from "./task-assignees";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

describe("taskAssigneeIds", () => {
  it("reads the crew, first assignee first", () => {
    expect(taskAssigneeIds({ assigned_user_id: A, assignee_ids: [A, B] })).toEqual([A, B]);
  });

  it("falls back to the one assignee on a row without assignee_ids", () => {
    expect(taskAssigneeIds({ assigned_user_id: A })).toEqual([A]);
    expect(taskAssigneeIds({ assigned_user_id: null })).toEqual([]);
  });

  it("an empty crew is nobody even if a stale first assignee is present", () => {
    expect(taskAssigneeIds({ assigned_user_id: A, assignee_ids: [] })).toEqual([]);
  });
});

describe("isAssignedTo", () => {
  it("is true for anyone on the task, not only the first", () => {
    const task = { assigned_user_id: A, assignee_ids: [A, B] };
    expect(isAssignedTo(task, B)).toBe(true);
    expect(isAssignedTo(task, C)).toBe(false);
  });
});

describe("sameCrew", () => {
  it("ignores order", () => {
    expect(sameCrew([A, B], [B, A])).toBe(true);
    expect(sameCrew([A], [A, B])).toBe(false);
  });
});

describe("toggleAssignee", () => {
  it("adds and removes one person", () => {
    expect(toggleAssignee([A], B)).toEqual([A, B]);
    expect(toggleAssignee([A, B], A)).toEqual([B]);
  });

  it("stops adding at the cap but still lets someone leave", () => {
    const full = Array.from({ length: MAX_ASSIGNEES }, (_, i) => `u${i}`);
    expect(toggleAssignee(full, C)).toEqual(full);
    expect(toggleAssignee(full, "u0")).toHaveLength(MAX_ASSIGNEES - 1);
  });
});

describe("assigneeNames", () => {
  const roster = new Map([[B, "Ben"]]);

  it("prefers the names the server sent, then the roster, then the fallback", () => {
    const names = assigneeNames(
      {
        assigned_user_id: A,
        assignee_ids: [A, B, C],
        assignees: [{ user_id: A, display_name: "Ana" }],
      },
      roster,
      "Teammate",
    );
    expect(names).toEqual(["Ana", "Ben", "Teammate"]);
  });
});
