import type { ConversationEvent } from "@/lib/api/types";

/**
 * #465: where a timeline line goes when it is clicked.
 *
 * The complaint was that these lines are only ever text: "X created a task"
 * names a task and could not open it, and a done line quotes a message and
 * could not reach it. Only the two that genuinely name a destination are
 * actionable — an assignment or a tag change names nothing to open, and a
 * false affordance is worse than a quiet line.
 *
 * `task_deleted` is deliberately absent: the task it names no longer exists.
 *
 * Kept pure and separate from <SystemLine> so it is unit-tested directly, and
 * so the hand-ported Kotlin (`Timeline.kt` eventTargetOf) and Swift
 * (`Timeline.swift` eventTarget(of:)) have one shape to match rather than a
 * condition buried in a component. The three run the same vectors.
 */
export type EventTarget =
  | { kind: "task"; id: string }
  | { kind: "message"; id: string };

/**
 * Task events that carry `payload.task_id` and still have a task to open.
 * Listed here rather than reusing `isTaskEventType` because that set includes
 * `task_deleted`, which must NOT be openable.
 */
const TASK_EVENT_TYPES = new Set([
  "task_created",
  "task_assigned",
  "task_due_set",
  "task_attachment_added",
  "task_attachment_removed",
]);

export function eventTarget(
  event: Pick<ConversationEvent, "type" | "payload">,
): EventTarget | null {
  if (TASK_EVENT_TYPES.has(event.type)) {
    const id = event.payload.task_id;
    return typeof id === "string" && id !== "" ? { kind: "task", id } : null;
  }
  if (event.type === "message_done" || event.type === "message_undone") {
    const id = event.payload.message_id;
    return typeof id === "string" && id !== "" ? { kind: "message", id } : null;
  }
  return null;
}
