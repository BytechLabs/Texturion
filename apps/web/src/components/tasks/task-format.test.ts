import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/provider";

import {
  NO_CONVERSATION,
  taskCallerName,
  taskThreadHref,
  taskThreadId,
} from "./task-format";

const t = makeTranslate("en");

describe("D64 a task that came from a call", () => {
  it("links a message task to its message and a call task to the thread", () => {
    expect(taskThreadHref({ id: "t1", conversation_id: "c1", message_id: "m1" })).toBe(
      "/inbox/c1?message=m1",
    );
    expect(taskThreadHref({ id: "t1", conversation_id: "c1", message_id: null })).toBe(
      "/inbox/c1",
    );
  });

  it("links a standalone task with no conversation to its own panel (#689)", () => {
    expect(
      taskThreadHref({ id: "t9", conversation_id: null, message_id: null }),
    ).toBe("/tasks?task=t9");
    expect(taskThreadId({ conversation_id: null })).toBe(NO_CONVERSATION);
    expect(taskThreadId({ conversation_id: "c1" })).toBe("c1");
  });

  it("names who rang: CNAM name, else the number, else unknown; null for a message task", () => {
    const call = {
      id: "k1",
      call_session_id: "s1",
      caller_e164: "+14165550133",
      caller_name: null,
      outcome: "answered" as const,
      forward_seconds: 60,
      started_at: "2026-08-08T18:00:00.000Z",
      ended_at: null,
      contact_id: null,
      has_voicemail: false,
    };
    expect(taskCallerName({ call: { ...call, caller_name: "Pat" } }, t)).toBe("Pat");
    expect(taskCallerName({ call }, t)).toBe("(416) 555-0133");
    expect(taskCallerName({ call: { ...call, caller_e164: null } }, t)).toBe(
      "Unknown caller",
    );
    expect(taskCallerName({ call: null }, t)).toBeNull();
  });
});
