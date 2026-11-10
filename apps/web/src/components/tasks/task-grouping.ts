import type { Task, TaskPriority } from "@/lib/api/types";

import { normalizePriority, PRIORITY_PICKER } from "./task-planning";
import { taskAssigneeIds } from "./task-assignees";
import type { TaskGroup } from "./task-view-url";

/**
 * #689 G: the board's columns when it is grouped by assignee or priority.
 * Grouping by status is the board's own two columns and is not handled here.
 *
 * A task with several people sits under the first of them, so each card shows
 * once; a task with nobody sits under the unassigned column, last.
 */
export interface TaskColumn {
  /** Stable key: a user id, `none`, or a priority. */
  key: string;
  kind: "assignee" | "unassigned" | "priority";
  priority?: TaskPriority;
  tasks: Task[];
}

export function groupTasks(tasks: Task[], group: Exclude<TaskGroup, "status">): TaskColumn[] {
  if (group === "priority") {
    return PRIORITY_PICKER.map((priority) => ({
      key: priority,
      kind: "priority" as const,
      priority,
      tasks: tasks.filter((task) => normalizePriority(task.priority) === priority),
    })).filter((column) => column.tasks.length > 0);
  }
  const byPerson = new Map<string, Task[]>();
  const nobody: Task[] = [];
  for (const task of tasks) {
    const first = taskAssigneeIds(task)[0];
    if (first === undefined) nobody.push(task);
    else byPerson.set(first, [...(byPerson.get(first) ?? []), task]);
  }
  const columns: TaskColumn[] = [...byPerson.entries()].map(([key, list]) => ({
    key,
    kind: "assignee" as const,
    tasks: list,
  }));
  if (nobody.length > 0) columns.push({ key: "none", kind: "unassigned", tasks: nobody });
  return columns;
}
