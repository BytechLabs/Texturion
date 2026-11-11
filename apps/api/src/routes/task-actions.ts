import type { MemberRole } from "@loonext/shared";
import { stateMachines } from "@loonext/shared";

/**
 * #722: a live task's state, derived the way the database does it: done when
 * task_done_at is set (the source message's done_at for a promoted task, else
 * the task's own). A trashed task is never served by these routes, so only
 * open and done occur.
 */
export function liveTaskState(done: boolean): stateMachines.TaskState {
  return done ? "done" : "open";
}

/** What `role` may do to a live task now, from the shared machine. */
export function taskAllowedActions(
  done: boolean,
  role: MemberRole,
): readonly string[] {
  return stateMachines.allowedActions(
    stateMachines.taskMachine,
    liveTaskState(done),
    role,
  );
}

/**
 * The machine action a done toggle is. Null when the request changes nothing:
 * a second tap on the same state is not an action.
 */
export function doneToggleAction(
  currentlyDone: boolean,
  wantDone: boolean,
): "complete" | "reopen" | null {
  if (currentlyDone === wantDone) return null;
  return wantDone ? "complete" : "reopen";
}
