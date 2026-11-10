/**
 * #690: write down what a note, a task description or a task comment points at.
 *
 * The SQL function `api_sync_references` reads the SAVED text for `#T-142`,
 * `#contact-1a2b3c4d` and `#conv-1a2b3c4d`, drops any target the writer may not
 * see, and replaces the source's rows. It runs after the text is saved and
 * never fails the save: a note whose references did not land is still a note.
 *
 * Only text a member writes for the crew is ever passed here. A message to a
 * customer is not, so a `#` typed into one stays a `#` and nothing in it is
 * read as a link.
 */
import type { Context } from "hono";

import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import type { getDb } from "../db";

type Db = ReturnType<typeof getDb>;

export type ReferenceSource = "note" | "task_description" | "task_comment";

/** A cheap test for "could this text hold a reference at all". */
export function mayHoldReference(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes("#");
}

export async function syncReferences(
  c: Context<AppEnv>,
  db: Db,
  args: { sourceKind: ReferenceSource; sourceId: string; text: string | null },
): Promise<void> {
  try {
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });
    const { error } = await db.rpc("api_sync_references", {
      p_company_id: c.get("companyId"),
      p_source_kind: args.sourceKind,
      p_source_id: args.sourceId,
      p_text: args.text ?? "",
      p_actor_user_id: c.get("userId"),
      p_hidden_number_ids: access.hiddenNumberIds,
    });
    if (error) console.error("reference sync failed:", error.message);
  } catch (cause) {
    console.error("reference sync failed:", cause);
  }
}
