/**
 * Who may see a given conversation.
 *
 * Every background sender that names a customer, quotes their message, or deep
 * links into a thread has to answer this question, and until now each one
 * answered it with its own copy of the same twenty lines. Two copies had
 * already drifted into place (inbound message alerts and missed-call alerts);
 * a third would have shipped with mentions.
 *
 * The rule (#106): an ACTIVE member of the company whose access level on the
 * conversation's number is not 'none'. Owners and admins always pass. Level
 * 'note' is INSIDE the set: a notes-only member reads the thread and posts
 * notes, so gating on 'text' would drop a legitimate reader.
 *
 * Number access is a DENY-LIST: a number with no rules at all is visible to
 * everyone, and a conversation with no number (`phone_number_id` null) is
 * visible to the whole company. Both mirror the SQL-side filter.
 *
 * Takes the number id rather than a conversation id deliberately.
 * `resolveConversationLevel` answers 'text' for a conversation row that does
 * not exist, because routes own their own 404. A background sender has no such
 * fallback, and inheriting that default would mean notifying the whole company
 * about a row that has since vanished. Callers load the conversation under
 * their own company scope first and fail loudly when it is gone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberRole } from "../context";

import { levelFromRules, type NumberAccessRule } from "./number-access";

export interface ConversationViewer {
  user_id: string;
  role: MemberRole;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  // A membership or access read that failed must never read as "nobody has
  // access": that silently turns a broken query into a delivered-to-nobody
  // alert. Throw and let the caller's error path own it.
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export async function listConversationViewers(
  db: SupabaseClient,
  args: { companyId: string; phoneNumberId: string | null | undefined },
): Promise<ConversationViewer[]> {
  const members = unwrapRows<ConversationViewer>(
    await db
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", args.companyId)
      .is("deactivated_at", null),
    "company members lookup",
  );

  // No number on the conversation: nothing to restrict against. Absent counts
  // as none, so a projection that simply omits the column cannot cause an
  // access lookup against a number that was never there.
  if (!args.phoneNumberId) return members;

  const rules = unwrapRows<NumberAccessRule>(
    await db
      .from("number_access")
      .select("phone_number_id,principal_kind,principal,level")
      .eq("company_id", args.companyId)
      .eq("phone_number_id", args.phoneNumberId),
    "number access lookup",
  );
  // Deny-list: an unrestricted number is everyone's.
  if (rules.length === 0) return members;

  return members.filter((member) => {
    if (member.role === "owner" || member.role === "admin") return true;
    return levelFromRules(rules, member.user_id, member.role) !== "none";
  });
}
