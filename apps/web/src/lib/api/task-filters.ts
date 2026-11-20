import type { TaskPriority, TaskStatus } from "./types";

/**
 * GET /v1/tasks defaults to the caller's open work when no filters are sent.
 */
export interface TaskListFilters {
  /** Derived status filter, applied on the joined messages.done_at. */
  status?: TaskStatus;
  /** A user ID, `me` for the caller, or `all` to include every assignee and unassigned work. */
  assigned_user_id?: string;
  /** Only unassigned tasks. */
  unassigned?: boolean;
  /** Scope to one conversation (the checklist uses its own endpoint instead). */
  conversation_id?: string;
  /** ISO instants for the due-range views (calendar). */
  due_before?: string;
  due_after?: string;
  due_on_before?: string;
  due_on_after?: string;
  /** Past-due AND not-done (overdue is never applied to done tasks). */
  overdue?: boolean;
  confirmed?: boolean;
  scheduled?: boolean;
  /** Only tasks whose conversation→contact has a lat/lng (the Map view). */
  has_location?: boolean;
  /** Title trigram search. */
  q?: string;
  /** #693: any of these priorities. */
  priority?: TaskPriority[];
  /** #693: tasks carrying this workspace tag. */
  tag_id?: string;
  /** #693: list order. Absent is newest first. */
  sort?: "created" | "due" | "priority" | "updated";
  /** #690: tasks for this customer, directly or through their conversations. */
  contact_id?: string;
  /** #690: made by this member (`me` or a user id). */
  created_by?: string;
  /** #690: promoted from a text, from a call, or from neither. */
  source?: "text" | "call" | "none";
  source_line_id?: string;
  /** #690: carries a file. */
  has_attachments?: boolean;
  /** #690: referenced from a note, a task or a comment. */
  has_references?: boolean;
}
