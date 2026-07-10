import type { TaskDetail } from "@/lib/api/types";

/**
 * Delete-gating for the task detail panel (#89).
 *
 * Deleting a task is destructive and irreversible from the user's side (the API
 * soft-deletes — there is no restore UI). A brand-new task with nothing on it is
 * cheap to recreate, so it deletes without friction; a task that carries a
 * discussion (notes) or attached files is worth a confirmation first. Pure, so
 * the decision + the confirm phrasing are unit-tested without rendering.
 *
 * Note (D28): task events are always present (`task_created` at minimum), so
 * they do NOT count as content — only user-authored notes and attachments do.
 */
export interface TaskDeleteContent {
  notes: number;
  attachments: number;
  /** Whether to confirm before deleting (there is something to lose). */
  hasContent: boolean;
}

export function taskDeleteContent(
  task: Pick<TaskDetail, "activity" | "attachments">,
): TaskDeleteContent {
  const notes = task.activity.filter((item) => item.kind === "note").length;
  const attachments = task.attachments.length;
  return { notes, attachments, hasContent: notes > 0 || attachments > 0 };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A short phrase naming what the task carries, for the confirm copy — e.g.
 * "3 notes and 2 files", "a note", "2 files". Empty when there is nothing (the
 * no-friction path, where no confirm is shown at all).
 */
export function taskDeleteSummary(notes: number, attachments: number): string {
  const parts: string[] = [];
  if (notes > 0) parts.push(notes === 1 ? "a note" : plural(notes, "note"));
  if (attachments > 0) {
    parts.push(attachments === 1 ? "a file" : plural(attachments, "file"));
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} and ${parts[1]}`;
}
