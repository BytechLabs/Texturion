/**
 * #465: which timeline lines go somewhere when clicked.
 *
 * These vectors are shared VERBATIM with the Kotlin (TimelineTest.kt) and
 * Swift (MessagingTimelineTests.swift) ports. The selector is hand-ported to
 * two other languages, so a case that only one of them gets right is exactly
 * the failure this triple is here to catch: a crew comparing the phone and the
 * laptop must not find a line live on one and dead on the other.
 */
import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@/lib/api/types";

import { eventTarget } from "./event-target";

function event(
  type: string,
  payload: Record<string, unknown> = {},
): Pick<ConversationEvent, "type" | "payload"> {
  return { type: type as ConversationEvent["type"], payload };
}

/** Every task event that still has a task behind it. */
const TASK_EVENTS = [
  "task_created",
  "task_assigned",
  "task_due_set",
  "task_attachment_added",
  "task_attachment_removed",
] as const;

/** Lines that name no destination. A tag change has nowhere to go. */
const INERT_EVENTS = [
  "assigned",
  "tag_added",
  "tag_removed",
  "status_changed",
  "call_completed",
  "missed_call",
  "opted_out",
  "media_refused",
] as const;

describe("eventTarget", () => {
  it.each(TASK_EVENTS)("%s opens its task", (type) => {
    expect(eventTarget(event(type, { task_id: "t1" }))).toEqual({
      kind: "task",
      id: "t1",
    });
  });

  it("a deleted task offers nothing to open", () => {
    // The task it names no longer exists, so a click would dead-end.
    expect(eventTarget(event("task_deleted", { task_id: "t1" }))).toBeNull();
  });

  it("done and undone lines go to the message they quote", () => {
    expect(eventTarget(event("message_done", { message_id: "m1" }))).toEqual({
      kind: "message",
      id: "m1",
    });
    expect(eventTarget(event("message_undone", { message_id: "m1" }))).toEqual({
      kind: "message",
      id: "m1",
    });
  });

  it("a line whose payload names no target stays inert", () => {
    // A truncated or older payload must not produce a click that goes nowhere.
    expect(eventTarget(event("task_created"))).toBeNull();
    expect(eventTarget(event("message_done"))).toBeNull();
    // An untrusted payload can carry the wrong type or an empty string; both
    // would render an affordance pointing at nothing.
    expect(eventTarget(event("task_created", { task_id: 42 }))).toBeNull();
    expect(eventTarget(event("message_done", { message_id: "" }))).toBeNull();
  });

  it.each(INERT_EVENTS)("%s is never actionable", (type) => {
    // Restraint is the point: these name nothing to open, and a false
    // affordance is worse than a quiet line. Passing a task_id proves the
    // decision is made by the TYPE, not by whatever the payload happens to
    // carry.
    expect(eventTarget(event(type, { task_id: "t1", message_id: "m1" }))).toBeNull();
  });
});
