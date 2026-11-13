import type { TaskListFilters } from "./task-filters";

/**
 * A GET /v1/tasks request: the filters plus an optional page size. The route
 * takes 1 to 100 and answers 25 without one (routes/tasks.ts).
 */
export type TaskListRequest = TaskListFilters & { limit?: number };

/**
 * The request as a query key: absent, false and empty-list values dropped, since
 * the serializer below sends none of them, so equal requests share one entry.
 * The page size stays in: a probe for one row must never answer a list.
 */
export function taskListKeyFilters(request: TaskListRequest): TaskListRequest {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as TaskListRequest;
}

/**
 * Serialize the /tasks page's UI filters into the GET /v1/tasks query params
 * (routes/tasks.ts). Pure and dependency-free so it is unit-testable in
 * isolation (the hooks module that consumes it pulls in the whole React-Query +
 * provider chain, which a plain .ts test can't transform).
 *
 * `assigned_user_id: "all"` is the page's "everything" sugar — the assignee pin
 * is dropped (so the route sees no `assigned_user_id` and returns every
 * assignee's rows), but the route's Open·Mine default must still be bypassed.
 * Booleans are sent only when true; absent params keep the route defaults intact.
 */
export function taskSearchParams(
  filters: TaskListRequest,
  cursor: string | undefined,
): Record<string, string | number | boolean | undefined> {
  const explicitAll = filters.assigned_user_id === "all";

  // The "All" tab means "every assignee", which requires TWO things from the
  // frozen route (routes/tasks.ts): (1) no `assigned_user_id` param, so the
  // route does not pin the caller; and (2) at least one EXPLICIT filter param,
  // so `anyFilter` is true and the route does NOT re-apply its Open·Mine
  // default (a bare `/v1/tasks` returns status=open + assignee=me — only the
  // caller's open tasks). The route keys `anyFilter` off truthy filters, and
  // every truthy trigger except a pinned assignee (which we must NOT send)
  // also applies a real predicate — so `status` is the only opt-out that keeps
  // the query semantically clean. When no OTHER explicit filter is present we
  // send `status=open`, giving "every assignee's open tasks" — the coherent
  // "All" set (Done is its own tab). A caller that already carries a status /
  // due / q / has_location / unassigned filter needs no sentinel (that param
  // is itself the opt-out), so we only inject `status=open` as a last resort.
  const needsAllSentinel =
    explicitAll &&
    !filters.status &&
    !filters.overdue &&
    !filters.conversation_id &&
    !filters.due_before &&
    !filters.due_after &&
    !filters.q &&
    !filters.has_location &&
    !filters.unassigned &&
    !filters.contact_id &&
    !filters.created_by &&
    !filters.source &&
    !filters.has_attachments &&
    !filters.has_references;
  const status = filters.status ?? (needsAllSentinel ? "open" : undefined);

  return {
    status,
    assigned_user_id: explicitAll ? undefined : filters.assigned_user_id,
    unassigned: filters.unassigned ? true : undefined,
    conversation_id: filters.conversation_id,
    due_before: filters.due_before,
    due_after: filters.due_after,
    overdue: filters.overdue ? true : undefined,
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
    has_attachments: filters.has_attachments ? true : undefined,
    has_references: filters.has_references ? true : undefined,
    limit: filters.limit,
    cursor,
  };
}
