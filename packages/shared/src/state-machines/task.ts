import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A task's lifecycle, derived from task_done_at(tasks) and deleted_at.
 * task_done_at is the source message's done_at when the task was promoted from
 * a message, else the task's own done_at. Trashed wins: production has one
 * task that is both done and trashed. Restore returns to open or done
 * depending on done_at, so trashed has two exits.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type TaskState = "open" | "done" | "trashed";

export const taskMachine = defineMachine<TaskState>({
  id: "task",
  description: "A task's lifecycle, derived from task_done_at(tasks) and deleted_at.",
  authority: "derived",
  db: {
    kind: "none",
    columns: [{ table: "tasks", column: "done_at" }, { table: "tasks", column: "deleted_at" }],
    note: "derived from done_at and deleted_at timestamps",
  },
  states: ["open", "done", "trashed"],
  initial: ["open"],
  transitions: {
    open: ["done", "trashed"],
    done: ["open", "trashed"],
    trashed: ["open", "done"],
  },
  entryEffects: {
    done: ["stamp_done_by", "cancel_task_reminders", "cancel_calendar_event"],
    trashed: ["cancel_task_reminders", "cancel_calendar_event"],
  },
  actions: capabilityActions<TaskState>({
    open: [{ action: "complete", capability: "conversations.note" }, { action: "trash", capability: "records.delete" }],
    done: [{ action: "reopen", capability: "conversations.note" }, { action: "trash", capability: "records.delete" }],
    trashed: [{ action: "restore", capability: "records.delete" }],
  }),
});
