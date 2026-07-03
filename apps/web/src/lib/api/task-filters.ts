import type { TaskStatus } from "./types";

/**
 * The GET /v1/tasks filter params (routes/tasks.ts). Every field is optional;
 * an ABSENT filter set (all undefined) hits the route's default "what needs me
 * now" view (`status=open, assignee=me`). The /tasks page maps its segmented
 * tabs + chips to this shape:
 *
 *   Open  → { status: "open", assigned_user_id: "me" }
 *   Mine  → { assigned_user_id: "me" }
 *   All   → { assigned_user_id: "all" } — the "all" sugar drops the assignee pin
 *           and forces one explicit param (`status=open`, a filter the frozen
 *           route honors) so the Open·Mine default isn't re-applied
 *   Done  → { status: "done", assigned_user_id: "me" }
 *
 * Kept in its own dependency-free module so the pure serializer
 * (`taskSearchParams`) and `toTaskFilters` can import the type without pulling
 * in the React-Query hook chain (which a plain .ts unit test can't transform).
 */
export interface TaskListFilters {
  /** Derived status filter, applied on the joined messages.done_at. */
  status?: TaskStatus;
  /**
   * `me` (server resolves to the caller), a concrete user id, or `all` — the
   * escape hatch that opts out of the route's Open·Mine default without pinning
   * an assignee. `all` is normalized away before the request (the assignee pin
   * is dropped) but forces one explicit param the frozen route honors
   * (`status=open`) so the default view never re-applies (see taskSearchParams).
   */
  assigned_user_id?: string;
  /** Only unassigned tasks. */
  unassigned?: boolean;
  /** Scope to one conversation (the checklist uses its own endpoint instead). */
  conversation_id?: string;
  /** ISO instants for the due-range views (calendar). */
  due_before?: string;
  due_after?: string;
  /** Past-due AND not-done (overdue is never applied to done tasks). */
  overdue?: boolean;
  /** Only tasks whose conversation→contact has a lat/lng (the Map view). */
  has_location?: boolean;
  /** Title trigram search. */
  q?: string;
}
