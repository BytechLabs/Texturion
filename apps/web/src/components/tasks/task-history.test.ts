import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/provider";
import type { TaskFeedItem } from "@/lib/api/types";

import { taskHistorySentence } from "./task-history";

const t = makeTranslate("en");

function event(
  overrides: Partial<Extract<TaskFeedItem, { kind: "event" }>>,
): Extract<TaskFeedItem, { kind: "event" }> {
  return {
    kind: "event",
    id: "e1",
    event: "created",
    from: null,
    to: null,
    from_user: null,
    to_user: null,
    actor: null,
    created_at: "2026-11-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("taskHistorySentence", () => {
  it("names the person and the change", () => {
    expect(taskHistorySentence(event({ event: "created" }), "Rehman", t)).toBe(
      "Rehman created this task",
    );
    expect(
      taskHistorySentence(
        event({ event: "title", to: "Fix furnace" }),
        "Rehman",
        t,
      ),
    ).toContain("Fix furnace");
  });

  it("says who a task was assigned to, or that it was unassigned", () => {
    const assigned = event({
      event: "assignee",
      to: "u2",
      to_user: { user_id: "u2", display_name: "Sam" },
    });
    expect(taskHistorySentence(assigned, "Rehman", t)).toBe(
      "Rehman assigned this to Sam",
    );
    expect(
      taskHistorySentence(event({ event: "assignee", to: null }), "Rehman", t),
    ).toBe("Rehman unassigned this task");
  });

  it("reads a due time as a weekday and time, and a cleared one as cleared", () => {
    const set = taskHistorySentence(
      event({ event: "due", to: "2026-11-10T14:00:00.000Z" }),
      "Rehman",
      t,
    );
    expect(set).toMatch(
      /^Rehman changed the due time to \w{3} \d{1,2}:\d{2} [AP]M$/,
    );
    expect(
      taskHistorySentence(event({ event: "due", to: null }), "Rehman", t),
    ).toBe("Rehman cleared the due time");
  });

  it("tells reminders on from off, and done from reopened", () => {
    expect(
      taskHistorySentence(event({ event: "reminders", to: true }), "Sam", t),
    ).toBe("Sam turned reminders off");
    expect(
      taskHistorySentence(event({ event: "reminders", to: false }), "Sam", t),
    ).toBe("Sam turned reminders on");
    expect(taskHistorySentence(event({ event: "done" }), "Sam", t)).toBe(
      "Sam marked this done",
    );
    expect(taskHistorySentence(event({ event: "reopened" }), "Sam", t)).toBe(
      "Sam reopened this task",
    );
  });
});
