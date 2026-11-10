import type { Task } from "@/lib/api/types";

/** A task holds at most this many people. The API refuses more. */
export const MAX_ASSIGNEES = 10;

/** Avatars drawn before the rest collapse into "+N". */
export const STACK_LIMIT = 3;

type CrewFields = Pick<Task, "assigned_user_id" | "assignee_ids">;

/**
 * Everyone on a task, first assignee first. A payload without `assignee_ids`
 * (an older cached row) falls back to the one assignee it does carry.
 */
export function taskAssigneeIds(task: CrewFields): string[] {
  if (task.assignee_ids) return task.assignee_ids;
  return task.assigned_user_id ? [task.assigned_user_id] : [];
}

/** "Mine" means being one of them. */
export function isAssignedTo(task: CrewFields, userId: string): boolean {
  return taskAssigneeIds(task).includes(userId);
}

/** The same people, in any order. */
export function sameCrew(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The crew with one person added or taken off. Adding past the cap changes nothing. */
export function toggleAssignee(
  ids: readonly string[],
  userId: string,
  max: number = MAX_ASSIGNEES,
): string[] {
  if (ids.includes(userId)) return ids.filter((id) => id !== userId);
  return ids.length >= max ? [...ids] : [...ids, userId];
}

/**
 * Display names for a task's crew: the names the server sent with the task,
 * then the member roster, then `fallback` for someone who has since left.
 */
export function assigneeNames(
  task: Pick<Task, "assigned_user_id" | "assignee_ids" | "assignees">,
  roster: ReadonlyMap<string, string>,
  fallback: string,
): string[] {
  return taskAssigneeIds(task).map((id) => {
    const sent = task.assignees?.find((person) => person.user_id === id);
    return sent?.display_name?.trim() || roster.get(id) || fallback;
  });
}
