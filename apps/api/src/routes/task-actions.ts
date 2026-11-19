import type { MemberRole, NumberAccessLevel } from "@loonext/shared";
import { roleHasCapability, stateMachines } from "@loonext/shared";

/**
 * #722: a live task's state, derived the way the database does it: done when
 * task_done_at is set (the source message's done_at for a promoted task, else
 * the task's own). A trashed task is never served by these routes, so only
 * open and done occur.
 */
export function liveTaskState(done: boolean): stateMachines.TaskState {
  return done ? "done" : "open";
}

/** A live task's state transitions and any actions on its conversation. */
export function taskAllowedActions(
  done: boolean,
  role: MemberRole,
  level?: NumberAccessLevel,
): readonly string[] {
  const actions = stateMachines.allowedActions(
    stateMachines.taskMachine,
    liveTaskState(done),
    role,
  );
  return level === "text" && roleHasCapability(role, "conversations.send")
    ? [...actions, "share_photos"]
    : actions;
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
