import { describe, expect, it } from "vitest";

import { isTaskEventType, taskEventSentence } from "./task-activity";

const name = (id: string | null): string | null =>
  id === "u-marcus" ? "Marcus" : id === "u-jordan" ? "Jordan" : null;

describe("taskEventSentence", () => {
  it("renders the create line", () => {
    expect(
      taskEventSentence(
        { type: "task_created", payload: { task_id: "t1" } },
        "Jordan",
        name,
      ),
    ).toBe("Jordan turned this into a task");
  });

  it("renders 'assigned to <name>' and resolves the assignee", () => {
    expect(
      taskEventSentence(
        {
          type: "task_assigned",
          payload: { task_id: "t1", to_user_id: "u-marcus" },
        },
        "Jordan",
        name,
      ),
    ).toBe("Jordan assigned this to Marcus");
  });

  it("renders 'unassigned' when to_user_id is null", () => {
    expect(
      taskEventSentence(
        { type: "task_assigned", payload: { task_id: "t1", to_user_id: null } },
        "Jordan",
        name,
      ),
    ).toBe("Jordan unassigned this task");
  });

  it("renders a due-set line with a time", () => {
    const sentence = taskEventSentence(
      {
        type: "task_due_set",
        payload: { task_id: "t1", due_at: "2026-07-03T15:00:00Z" },
      },
      "Jordan",
      name,
    );
    expect(sentence).toMatch(/^Jordan set the due date to /);
  });

  it("renders 'cleared the due date' when due_at is null", () => {
    expect(
      taskEventSentence(
        { type: "task_due_set", payload: { task_id: "t1", due_at: null } },
        "Jordan",
        name,
      ),
    ).toBe("Jordan cleared the due date");
  });

  it("renders the removed line", () => {
    expect(
      taskEventSentence(
        { type: "task_deleted", payload: { task_id: "t1" } },
        "Jordan",
        name,
      ),
    ).toBe("Jordan removed this task");
  });

  it("returns null for a non-task event type", () => {
    expect(
      taskEventSentence(
        { type: "status_changed", payload: {} },
        "Jordan",
        name,
      ),
    ).toBeNull();
  });
});

describe("isTaskEventType", () => {
  it("is true for task_* types and false otherwise", () => {
    expect(isTaskEventType("task_created")).toBe(true);
    expect(isTaskEventType("task_assigned")).toBe(true);
    expect(isTaskEventType("task_due_set")).toBe(true);
    expect(isTaskEventType("task_deleted")).toBe(true);
    expect(isTaskEventType("task_attachment_added")).toBe(true);
    expect(isTaskEventType("message_done")).toBe(false);
    expect(isTaskEventType("status_changed")).toBe(false);
  });
});
