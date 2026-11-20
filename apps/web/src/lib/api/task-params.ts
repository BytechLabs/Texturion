import type { TaskListFilters } from "./task-filters";

/**
 * A GET /v1/tasks request: the filters plus an optional page size. The route
 * takes 1 to 100 and answers 25 without one (routes/tasks.ts).
 */
export type TaskListRequest = TaskListFilters & {
  limit?: number;
  schedule_after?: string;
  schedule_before?: string;
  include_count?: boolean;
  calendar_undated?: boolean;
};

/**
 * Drop filter values the request omits so equal queries share one cache entry.
 */
export function taskListKeyFilters(request: TaskListRequest): TaskListRequest {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined || (value === false && key !== "confirmed" && key !== "scheduled")) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function taskSearchParams(
  filters: TaskListRequest,
  cursor: string | undefined,
): Record<string, string | number | boolean | undefined> {
  return {
    status: filters.status,
    assigned_user_id: filters.assigned_user_id,
    unassigned: filters.unassigned ? true : undefined,
    conversation_id: filters.conversation_id,
    due_before: filters.due_before,
    due_after: filters.due_after,
    due_on_before: filters.due_on_before,
    due_on_after: filters.due_on_after,
    schedule_after: filters.schedule_after,
    schedule_before: filters.schedule_before,
    include_count: filters.include_count || undefined,
    calendar_undated: filters.calendar_undated || undefined,
    overdue: filters.overdue ? true : undefined,
    confirmed: filters.confirmed,
    scheduled: filters.scheduled,
    has_location: filters.has_location ? true : undefined,
    q: filters.q,
    priority:
      filters.priority && filters.priority.length > 0
        ? filters.priority.join(",")
        : undefined,
    tag_id: filters.tag_id,
    sort: filters.sort && filters.sort !== "created" ? filters.sort : undefined,
    contact_id: filters.contact_id,
    created_by: filters.created_by,
    source: filters.source,
    source_line_id: filters.source_line_id,
    has_attachments: filters.has_attachments ? true : undefined,
    has_references: filters.has_references ? true : undefined,
    limit: filters.limit,
    cursor,
  };
}
