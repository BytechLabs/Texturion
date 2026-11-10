import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";

/**
 * Active member, and not denied the number the task's thread is on (#106).
 * Asked before the due-soon and overdue pushes, which both carry a title.
 */
export async function assigneeMayHear(
  db: SupabaseClient,
  task: { company_id: string; conversation_id: string | null; assigned_user_id: string },
): Promise<boolean> {
  if (task.conversation_id !== null) {
    const conversation = await db
      .from("conversations")
      .select("phone_number_id")
      .eq("company_id", task.company_id)
      .eq("id", task.conversation_id)
      .limit(1);
    if (conversation.error) {
      throw new Error(`conversation lookup failed: ${conversation.error.message}`);
    }
    const row = ((conversation.data ?? []) as { phone_number_id: string | null }[])[0];
    if (!row) return false;
    const viewers = await listConversationViewers(db, {
      companyId: task.company_id,
      phoneNumberId: row.phone_number_id,
    });
    return viewers.some((viewer) => viewer.user_id === task.assigned_user_id);
  }

  const members = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", task.company_id)
    .eq("user_id", task.assigned_user_id)
    .is("deactivated_at", null)
    .limit(1);
  if (members.error) {
    throw new Error(`membership lookup failed: ${members.error.message}`);
  }
  return (members.data ?? []).length > 0;
}
