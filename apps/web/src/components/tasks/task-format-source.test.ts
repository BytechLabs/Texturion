import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { NO_CONVERSATION, taskSourceLink, taskThreadId } from "./task-format";

const t = makeTranslate("en");
const tFr = makeTranslate("fr-CA");

describe("#718 a source link names a source that exists, and only then", () => {
  const call = {
    id: "k1",
    call_session_id: "s1",
    caller_e164: "+14165550133",
    caller_name: "Pat",
    outcome: "answered" as const,
    forward_seconds: 60,
    started_at: "2026-08-08T18:00:00.000Z",
    ended_at: null,
    contact_id: null,
    has_voicemail: false,
  };

  it("a standalone task has no source link at all (#689)", () => {
    expect(
      taskSourceLink({ id: "t9", conversation_id: null, message_id: null }, t),
    ).toBeNull();
    expect(taskThreadId({ conversation_id: null })).toBe(NO_CONVERSATION);
    expect(taskThreadId({ conversation_id: "c1" })).toBe("c1");
  });

  it("a text opens the thread at that message with the task beside it", () => {
    expect(
      taskSourceLink(
        {
          id: "t1",
          conversation_id: "c1",
          message_id: "m1",
          contact: { name: "Sam" },
        },
        t,
      ),
    ).toEqual({
      kind: "text",
      label: "From a text from Sam",
      href: "/inbox/c1?message=m1&task=t1",
    });
  });

  it("on a narrow screen opens the message without the task drawer covering it", () => {
    expect(
      taskSourceLink(
        { id: "t1", conversation_id: "c1", message_id: "m1", contact: null },
        t,
        { besideTask: false },
      )?.href,
    ).toBe("/inbox/c1?message=m1");
  });

  it("does not invent a name it does not have", () => {
    expect(
      taskSourceLink(
        { id: "t1", conversation_id: "c1", message_id: "m1", contact: null },
        t,
      )?.label,
    ).toBe("From a text");
  });

  it("a note is named as a note", () => {
    expect(
      taskSourceLink(
        {
          id: "t1",
          conversation_id: "c1",
          message_id: "m1",
          source_message: { direction: "note" },
        },
        t,
      ),
    ).toMatchObject({ kind: "note", label: "Mentioned in a note" });
  });

  it("a call anchors to the call, not to the top of the thread", () => {
    expect(
      taskSourceLink(
        {
          id: "t1",
          conversation_id: "c1",
          message_id: null,
          source: { kind: "call", id: "k1" },
          call,
        },
        t,
      ),
    ).toEqual({
      kind: "call",
      label: "From a call with Pat",
      href: "/inbox/c1?call=s1&task=t1",
    });
  });

  it("a task in a conversation with no message or call has no source", () => {
    expect(
      taskSourceLink({ id: "t1", conversation_id: "c1", message_id: null }, t),
    ).toBeNull();
  });

  it("speaks French too", () => {
    expect(
      taskSourceLink(
        {
          id: "t1",
          conversation_id: "c1",
          message_id: "m1",
          contact: { name: "Sam" },
        },
        tFr,
      )?.label,
    ).toBe("À partir d'un texto de Sam");
  });
});
