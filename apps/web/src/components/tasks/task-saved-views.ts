import { sanitizeFilters, type SavedViewFilters } from "@loonext/shared";

import type { TaskPriority } from "@/lib/api/types";

import {
  parsePriorities,
  type TaskGroup,
  type TaskPageState,
  type TaskSort,
  type TaskSource,
} from "./task-view-url";

/**
 * #689 G: the /tasks page's state, in and out of a saved view.
 *
 * A view holds the query, never the result, and what it can hold is the shared
 * allow-list for the `tasks` surface. The tab is not a filter there, so it is
 * stored as what it means: Open is `status=open` for the saver, Mine is the
 * saver, Done is `status=done` for the saver, All is everyone's open tasks.
 *
 * Not stored: the view (list, board, calendar, map), the search text, and the
 * "today" and "this week" chips, because each means a different window tomorrow.
 * "Overdue" is stored, since it is always relative to now.
 */

export function taskStateToView(
  state: TaskPageState,
  userId: string,
): SavedViewFilters {
  const raw: Record<string, unknown> = {};
  const assignee = state.assignee ?? (state.tab === "all" ? undefined : userId);
  if (state.tab === "open" || state.tab === "all") raw.status = "open";
  if (state.tab === "done") raw.status = "done";
  if (state.unassigned) raw.unassigned = true;
  else if (assignee) raw.assigned_user_id = assignee;
  if (state.due === "overdue") raw.overdue = true;
  if (state.dueFrom) raw.due_after = localDayStart(state.dueFrom).toISOString();
  if (state.dueTo) {
    const end = localDayStart(state.dueTo);
    end.setDate(end.getDate() + 1);
    raw.due_before = end.toISOString();
  }
  if (state.priority && state.priority.length > 0) {
    raw.priority = state.priority.join(",");
  }
  if (state.tag) raw.tag_id = state.tag;
  if (state.sort && state.sort !== "created") raw.sort = state.sort;
  if (state.contact) raw.contact_id = state.contact;
  if (state.createdBy) raw.created_by = state.createdBy;
  if (state.source) raw.source = state.source;
  if (state.files) raw.has_attachments = true;
  if (state.refs) raw.has_references = true;
  if (state.group && state.group !== "status") raw.group = state.group;
  return sanitizeFilters("tasks", raw);
}

/**
 * A view's filters as page state. The current view, search text and any
 * "today" chip are kept from `current`: applying a view changes what is
 * shown, not how it is laid out.
 */
export function viewToTaskState(
  filters: SavedViewFilters,
  userId: string,
  current: TaskPageState,
): TaskPageState {
  const clean = sanitizeFilters("tasks", filters);
  const next: TaskPageState = { view: current.view, tab: "all" };
  if (current.q) next.q = current.q;

  const assignee =
    typeof clean.assigned_user_id === "string" ? clean.assigned_user_id : undefined;
  const mine = assignee === userId;
  if (clean.status === "done") next.tab = "done";
  else if (clean.status === "open") next.tab = mine ? "open" : "all";
  else next.tab = mine ? "mine" : "all";
  if (assignee !== undefined && !mine) next.assignee = assignee;
  if (clean.unassigned === true) next.unassigned = true;

  if (clean.overdue === true) next.due = "overdue";
  if (typeof clean.due_after === "string") next.dueFrom = localDate(new Date(clean.due_after));
  if (typeof clean.due_before === "string") {
    const end = new Date(clean.due_before);
    end.setDate(end.getDate() - 1);
    next.dueTo = localDate(end);
  }
  if (typeof clean.priority === "string") {
    const priorities: TaskPriority[] = parsePriorities(clean.priority);
    if (priorities.length > 0) next.priority = priorities;
  }
  if (typeof clean.tag_id === "string") next.tag = clean.tag_id;
  if (typeof clean.sort === "string") next.sort = clean.sort as TaskSort;
  if (typeof clean.contact_id === "string") next.contact = clean.contact_id;
  if (typeof clean.created_by === "string") next.createdBy = clean.created_by;
  if (typeof clean.source === "string") next.source = clean.source as TaskSource;
  if (clean.has_attachments === true) next.files = true;
  if (clean.has_references === true) next.refs = true;
  if (typeof clean.group === "string") next.group = clean.group as TaskGroup;
  return next;
}

/** True when the page already shows exactly what the view holds. */
export function taskViewMatches(
  filters: SavedViewFilters,
  state: TaskPageState,
  userId: string,
): boolean {
  const a = sanitizeFilters("tasks", filters);
  const b = taskStateToView(state, userId);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function localDayStart(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
