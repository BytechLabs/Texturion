import { describe, expect, it } from "vitest";

import type { TaskActivityItem, TaskAttachmentItem } from "@/lib/api/types";
import { taskDeleteContent, taskDeleteSummary } from "./task-delete";

function event(id: string): TaskActivityItem {
  return {
    kind: "event",
    id,
    type: "task_created",
    payload: {},
    actor_user_id: "u1",
    actor: null,
    created_at: "2026-07-02T10:00:00Z",
  };
}

function note(id: string): TaskActivityItem {
  return {
    kind: "note",
    id,
    body: `note-${id}`,
    author_user_id: "u1",
    author: null,
    created_at: "2026-07-02T10:05:00Z",
  };
}

function attachment(id: string): TaskAttachmentItem {
  return {
    id,
    source: "note",
    kind: "file",
    file_name: "file.pdf",
    content_type: "application/pdf",
    size_bytes: 10,
    created_at: "2026-07-02T10:00:00Z",
  };
}

describe("taskDeleteContent (#89 — confirm gating)", () => {
  it("a plain task (only the auto task_created event) has no content", () => {
    const result = taskDeleteContent({
      activity: [event("e1")],
      attachments: [],
    });
    expect(result).toEqual({ notes: 0, attachments: 0, hasContent: false });
  });

  it("events never count as content — only notes and attachments do", () => {
    expect(
      taskDeleteContent({
        activity: [event("e1"), event("e2")],
        attachments: [],
      }).hasContent,
    ).toBe(false);
  });

  it("a note makes the task worth confirming", () => {
    const result = taskDeleteContent({
      activity: [event("e1"), note("n1"), note("n2")],
      attachments: [],
    });
    expect(result).toEqual({ notes: 2, attachments: 0, hasContent: true });
  });

  it("an attachment alone makes the task worth confirming", () => {
    const result = taskDeleteContent({
      activity: [event("e1")],
      attachments: [attachment("a1")],
    });
    expect(result).toEqual({ notes: 0, attachments: 1, hasContent: true });
  });
});

describe("taskDeleteSummary (#89 — confirm copy)", () => {
  it("is empty when there is nothing (no confirm is shown)", () => {
    expect(taskDeleteSummary(0, 0)).toBe("");
  });

  it("names notes and files with correct pluralization", () => {
    expect(taskDeleteSummary(1, 0)).toBe("a note");
    expect(taskDeleteSummary(3, 0)).toBe("3 notes");
    expect(taskDeleteSummary(0, 1)).toBe("a file");
    expect(taskDeleteSummary(0, 2)).toBe("2 files");
  });

  it("joins both kinds with 'and'", () => {
    expect(taskDeleteSummary(2, 1)).toBe("2 notes and a file");
    expect(taskDeleteSummary(1, 3)).toBe("a note and 3 files");
  });
});
