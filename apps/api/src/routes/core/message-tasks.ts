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

/**
 * The set of message ids (from `messageIds`) that currently have a LIVE task.
 * Empty input → empty set (no query issued).
 */
export async function loadMessageTaskFlags(
  db: Db,
  companyId: string,
  messageIds: string[],
): Promise<Set<string>> {
  const promoted = new Set<string>();
  if (messageIds.length === 0) return promoted;
  const rows = unwrap<{ message_id: string }[]>(
    await db
      .from("tasks")
      .select("message_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("message_id", messageIds),
    "message task-flags lookup",
  );
  for (const row of rows) promoted.add(row.message_id);
  return promoted;
}
