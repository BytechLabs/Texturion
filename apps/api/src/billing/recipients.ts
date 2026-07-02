import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/**
 * Billing/grace notification audience (SPEC §9, §11): the owner plus active
 * admins. Member emails live in `auth.users`, not in public tables, so the
 * addresses come from the GoTrue admin API via the `sb_secret_` key — the same
 * credential path as every other Supabase call (SPEC §3).
 */
export async function billingRecipients(
  env: Env,
  companyId: string,
  db: SupabaseClient = getDb(env),
): Promise<string[]> {
  const { data, error } = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .is("deactivated_at", null)
    .in("role", ["owner", "admin"]);
  if (error) {
    throw new Error(`company_members lookup failed: ${error.message}`);
  }

  const emails: string[] = [];
  for (const row of data ?? []) {
    const userId = (row as { user_id: string }).user_id;
    const { data: userData, error: userError } =
      await db.auth.admin.getUserById(userId);
    if (userError) {
      throw new Error(
        `auth admin lookup failed for member ${userId}: ${userError.message}`,
      );
    }
    const email = userData.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}
