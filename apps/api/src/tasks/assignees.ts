/**
 * The people on a task (#689 C, D155).
 *
 * `task_assignees` is the truth and `tasks.assigned_user_id` is the first of
 * them, kept by a trigger, so a row read without this file still names one
 * assignee. Everything that needs the whole crew reads it here: the task
 * payloads (`assignee_ids` and `assignees`), the due and overdue pushes, and the
 * assignment pushes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { unwrap } from "../routes/core/http";

/** A task holds at most this many people. The table enforces it too. */
export const MAX_ASSIGNEES = 10;

/** The request field: up to ten member ids, repeats allowed (the DB drops them). */
export const assigneeIdsSchema = z.array(z.uuid()).max(MAX_ASSIGNEES);

export interface TaskAssignee {
  user_id: string;
  display_name: string | null;
}

interface AssigneeRow {
  task_id: string;
  user_id: string;
}

function groupByTask(rows: AssigneeRow[]): Map<string, string[]> {
  const byTask = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTask.get(row.task_id) ?? [];
    list.push(row.user_id);
    byTask.set(row.task_id, list);
  }
  return byTask;
}

/** Task id -> user ids, first assignee first. A task with nobody has no entry. */
export async function loadAssigneeIds(
  db: SupabaseClient,
  companyId: string,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = unwrap<AssigneeRow[]>(
    await db
      .from("task_assignees")
      .select("task_id,user_id")
      .eq("company_id", companyId)
      .in("task_id", taskIds)
      .order("added_at", { ascending: true })
      .order("user_id", { ascending: true }),
    "task assignees",
  );
  return groupByTask(rows);
}

/**
 * The same, for the scheduled notifiers, which batch tasks across every
 * workspace. The ids are ones the notifier just read off `tasks` itself, so
 * the crew can only be that task's.
 */
export async function loadAssigneeIdsAcrossTenants(
  db: SupabaseClient,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = unwrap<AssigneeRow[]>(
    await db
      .from("task_assignees")
      .select("task_id,user_id")
      .in("task_id", taskIds)
      .order("added_at", { ascending: true })
      .order("user_id", { ascending: true }),
    "task assignees",
  );
  return groupByTask(rows);
}

/** Task id -> the crew with display names. */
export async function loadAssignees(
  db: SupabaseClient,
  companyId: string,
  taskIds: string[],
): Promise<Map<string, TaskAssignee[]>> {
  const ids = await loadAssigneeIds(db, companyId, taskIds);
  const userIds = [...new Set([...ids.values()].flat())];
  const names = new Map<string, string | null>();
  if (userIds.length > 0) {
    const profiles = unwrap<{ user_id: string; display_name: string | null }[]>(
      await db.from("profiles").select("user_id,display_name").in("user_id", userIds),
      "assignee profiles",
    );
    for (const profile of profiles) names.set(profile.user_id, profile.display_name);
  }
  const out = new Map<string, TaskAssignee[]>();
  for (const [taskId, list] of ids) {
    out.set(
      taskId,
      list.map((user_id) => ({ user_id, display_name: names.get(user_id) ?? null })),
    );
  }
  return out;
}
