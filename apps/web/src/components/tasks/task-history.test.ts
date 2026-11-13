import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";
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

describe("taskHistorySentence assignees (#689 C)", () => {
  it("says who was added and who was removed", () => {
    expect(
      taskHistorySentence(
        event({
          event: "assignee_added",
          to: "u2",
          to_user: { user_id: "u2", display_name: "Ben" },
        }),
        "Rehman",
        t,
      ),
    ).toBe("Rehman added Ben to this task");
    expect(
      taskHistorySentence(
        event({
          event: "assignee_removed",
          from: "u2",
          from_user: { user_id: "u2", display_name: "Ben" },
        }),
        "Rehman",
        t,
      ),
    ).toBe("Rehman removed Ben from this task");
  });

  it("falls back to a plain update when the person has no name", () => {
    expect(
      taskHistorySentence(event({ event: "assignee_added", to: "u2" }), "Rehman", t),
    ).toBe("Rehman updated this task");
  });
});

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
    // Computed from now: the shared rule says "3:42 PM" for today and a weekday
    // within the week, so a fixed date would change its answer on its own day.
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const set = taskHistorySentence(
      event({ event: "due", to: inThreeDays }),
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

  it("describes priority, label and repeat changes (#693)", () => {
    expect(
      taskHistorySentence(event({ event: "priority", to: "urgent" }), "Sam", t),
    ).toBe("Sam set the priority to Urgent");
    expect(
      taskHistorySentence(
        event({ event: "label_added", to: { tag_id: "t1", name: "Warranty" } }),
        "Sam",
        t,
      ),
    ).toBe("Sam added the tag Warranty");
    expect(
      taskHistorySentence(
        event({ event: "label_removed", from: { tag_id: "t1", name: "Warranty" } }),
        "Sam",
        t,
      ),
    ).toBe("Sam removed the tag Warranty");
    expect(
      taskHistorySentence(
        event({
          event: "repeat",
          to: { kind: "schedule", unit: "week", every: 1, weekdays: [1], ends_kind: "never", paused: false },
        }),
        "Sam",
        t,
      ),
    ).toBe("Sam set this to repeat: Repeats every Monday");
    expect(taskHistorySentence(event({ event: "repeat", to: null }), "Sam", t)).toBe(
      "Sam stopped this repeating",
    );
  });
});

describe("taskHistorySentence links (#690)", () => {
  const link = (relation: string) => ({ relation, task_id: "t9", number: 4, title: "Order the part" });

  it("says each relation in both directions", () => {
    const added: [string, string][] = [
      ["blocked_by", "Rehman marked this as blocked by T-4 Order the part"],
      ["blocks", "Rehman marked this as blocking T-4 Order the part"],
      ["parent", "Rehman made this part of T-4 Order the part"],
      ["sub_task", "Rehman added T-4 Order the part as a sub-task"],
    ];
    for (const [relation, sentence] of added) {
      expect(taskHistorySentence(event({ event: "link_added", to: link(relation) }), "Rehman", t)).toBe(sentence);
    }
    const removed: [string, string][] = [
      ["blocked_by", "Rehman removed the block by T-4 Order the part"],
      ["blocks", "Rehman stopped this blocking T-4 Order the part"],
      ["parent", "Rehman took this out of T-4 Order the part"],
      ["sub_task", "Rehman removed sub-task T-4 Order the part"],
    ];
    for (const [relation, sentence] of removed) {
      expect(taskHistorySentence(event({ event: "link_removed", from: link(relation) }), "Rehman", t)).toBe(sentence);
    }
  });

  it("falls back to a plain line for a link it cannot read", () => {
    expect(taskHistorySentence(event({ event: "link_added", to: { relation: "friend" } }), "Rehman", t)).toBe(
      "Rehman updated this task",
    );
    expect(taskHistorySentence(event({ event: "link_added", to: null }), "Rehman", t)).toBe(
      "Rehman updated this task",
    );
  });
});
