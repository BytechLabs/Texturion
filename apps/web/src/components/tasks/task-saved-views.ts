import { sanitizeFilters } from '@loonext/shared';
import type { SavedViewFilters } from '@loonext/shared';

import type { Translate } from "@/i18n/translate";
import type { TaskPriority } from "@/lib/api/types";

import { parsePriorities, parseTaskColumns, parseView, TASK_COLUMNS } from './task-view-url';
import type { TaskGroup, TaskPageState, TaskSort, TaskSource } from './task-view-url';

export function taskStateToView(
  state: TaskPageState,
  userId: string,
): SavedViewFilters {
  const raw: Record<string, unknown> = { layout: state.view };
  const assignee = state.assignee ?? (state.tab === "all" ? undefined : userId);
  if (state.status) raw.status = state.status;
  else if (state.tab === "open" || state.tab === "done") raw.status = state.tab;
  if (state.columns && state.columns.length !== TASK_COLUMNS.length) raw.columns = state.columns.join(",");
  if (state.unassigned) raw.unassigned = true;
  else if (assignee) raw.assigned_user_id = assignee;
  if (state.due === "overdue") raw.overdue = true;
  else if (state.due) raw.due_relative = state.due;
  if (state.notConfirmed) raw.confirmed = false;
  if (state.scheduled !== undefined) raw.scheduled = state.scheduled;
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
  if (state.sourceLine) raw.source_line_id = state.sourceLine;
  if (state.files) raw.has_attachments = true;
  if (state.refs) raw.has_references = true;
  if (state.group && state.group !== "status") raw.group = state.group;
  return sanitizeFilters("tasks", raw);
}

/** Older saved views have no layout and use the one already open. */
export function viewToTaskState(
  filters: SavedViewFilters,
  userId: string,
  current: TaskPageState,
): TaskPageState {
  const clean = sanitizeFilters("tasks", filters);
  const view = typeof clean.layout === "string" ? parseView(clean.layout) : current.view;
  const next: TaskPageState = { view, tab: "all" };
  if (current.q) next.q = current.q;
  if (typeof clean.columns === "string") next.columns = parseTaskColumns(clean.columns);

  const assignee =
    typeof clean.assigned_user_id === "string" ? clean.assigned_user_id : undefined;
  const mine = assignee === userId;
  if (mine) {
    next.tab = clean.status === "open" || clean.status === "done" ? clean.status : "mine";
  } else if (clean.status === "open" || clean.status === "done") {
    next.status = clean.status;
  }
  if (assignee !== undefined && !mine) next.assignee = assignee;
  if (clean.unassigned === true) next.unassigned = true;

  if (clean.overdue === true) next.due = "overdue";
  else if (clean.due_relative === "today" || clean.due_relative === "week") next.due = clean.due_relative;
  if (clean.confirmed === false) next.notConfirmed = true;
  if (typeof clean.scheduled === "boolean") next.scheduled = clean.scheduled;
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
  if (typeof clean.source_line_id === "string") next.sourceLine = clean.source_line_id;
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
  if (a.layout === undefined) delete b.layout;
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

/** A name for the filters on screen, so the save field is never empty. */
export function suggestTaskViewName(state: TaskPageState, t: Translate): string {
  if (state.refs) return t("tasks.hasLinks");
  if (state.files) return t("tasks.hasFiles");
  if (state.due === "overdue") return t("tasks.overdue");
  if (state.source) {
    const source = {
      text: t("tasks.sourceText"),
      call: t("tasks.sourceCall"),
      none: t("tasks.sourceNone"),
    }[state.source];
    return t("tasks.chipSource", { source });
  }
  if (state.status === "open") return t("tasks.statusOpen");
  if (state.status === "done") return t("tasks.statusDone");
  if (state.assignee === "me") return t("tasks.myWork");
  if (state.tab === "all") return t("tasks.allTasks");
  if (state.tab === "done") return t("tasks.tabDone");
  if (state.tab === "mine") return t("tasks.tabMine");
  return t("tasks.tabOpen");
}
