/**
 * Per-message task-promotion flag (D17 / TASKS.md T5.1). A message is
 * "promoted" when a LIVE (`deleted_at IS NULL`) task rows over it. The thread UI
 * surfaces a quiet stone task indicator on a promoted message (APP-LAYOUT-V2
 * §4.1), so every message read surface (`GET /conversations/:id` and
 * `GET /conversations/:id/messages`) annotates each message with `has_task`.
 *
 * A single company-scoped batch query keeps this O(1) per page, mirroring
 * loadAttachments — the partial-unique `tasks_message_uq` (one live task per
 * message) means at most one row per message id.
 */
import { getDb } from "../../db";
import { unwrap } from "./http";

type Db = ReturnType<typeof getDb>;

/** A task embed for the thread ({ id, title }) — the promoted task or a
 * task-linked note's task. */
export interface NoteTaskLink {
  id: string;
  title: string;
}

/**
 * Map each message id (from `messageIds`) that currently has a LIVE task
 * promoted over it → that task's `{ id, title }`. The thread renders a "Task"
 * chip that OPENS the task, so the read surfaces need the task id, not just a
 * boolean. Empty input → empty map (no query issued). The partial-unique
 * `tasks_message_uq` (one live task per message) guarantees ≤1 row per id.
 */
export async function loadMessageTaskFlags(
  db: Db,
  companyId: string,
  messageIds: string[],
): Promise<Map<string, NoteTaskLink>> {
  const promoted = new Map<string, NoteTaskLink>();
  if (messageIds.length === 0) return promoted;
  const rows = unwrap<{ id: string; title: string; message_id: string }[]>(
    await db
      .from("tasks")
      .select("id,title,message_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("message_id", messageIds),
    "message task-flags lookup",
  );
  for (const row of rows) {
    promoted.set(row.message_id, { id: row.id, title: row.title });
  }
  return promoted;
}

/**
 * Resolve the linked task's `{ id, title }` for each task-linked note
 * (TASKS-V2 D-D). `taskIds` are the distinct non-null `messages.task_id`
 * values on a page; a soft-deleted task still resolves its title (the chip
 * stays meaningful even after the task is removed). Empty input → empty map.
 * Company-scoped (§10). One batched lookup per page.
 */
export async function loadNoteTaskLinks(
  db: Db,
  companyId: string,
  taskIds: string[],
): Promise<Map<string, NoteTaskLink>> {
  const byId = new Map<string, NoteTaskLink>();
  const distinct = [...new Set(taskIds)];
  if (distinct.length === 0) return byId;
  const rows = unwrap<{ id: string; title: string }[]>(
    await db
      .from("tasks")
      .select("id,title")
      .eq("company_id", companyId)
      .in("id", distinct),
    "note task-link lookup",
  );
  for (const row of rows) byId.set(row.id, { id: row.id, title: row.title });
  return byId;
}
