import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api/types";

import { groupTasks } from "./task-grouping";

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    priority: "normal",
    assigned_user_id: null,
    assignee_ids: [],
    done: false,
    ...over,
  }) as Task;

describe("groupTasks", () => {
  it("groups by priority, most pressing first, leaving out empty columns", () => {
    const columns = groupTasks(
      [task("a", { priority: "low" }), task("b", { priority: "urgent" }), task("c", { priority: "urgent" })],
      "priority",
    );
    expect(columns.map((c) => [c.key, c.tasks.map((t) => t.id)])).toEqual([
      ["urgent", ["b", "c"]],
      ["low", ["a"]],
    ]);
  });

  it("an unknown priority reads as normal", () => {
    const columns = groupTasks([task("a", { priority: "weird" as never })], "priority");
    expect(columns[0].key).toBe("normal");
  });

  it("groups by the first assignee, once per task, unassigned last", () => {
    const columns = groupTasks(
      [
        task("a", { assigned_user_id: "u1", assignee_ids: ["u1", "u2"] }),
        task("b"),
        task("c", { assigned_user_id: "u2", assignee_ids: ["u2"] }),
        task("d", { assigned_user_id: "u1", assignee_ids: ["u1"] }),
      ],
      "assignee",
    );
    expect(columns.map((c) => [c.key, c.kind, c.tasks.map((t) => t.id)])).toEqual([
      ["u1", "assignee", ["a", "d"]],
      ["u2", "assignee", ["c"]],
      ["none", "unassigned", ["b"]],
    ]);
  });

  it("returns nothing for no tasks", () => {
    expect(groupTasks([], "assignee")).toEqual([]);
    expect(groupTasks([], "priority")).toEqual([]);
  });
});
