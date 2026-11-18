import { type Capability, MEMBER_ROLES, roleHasCapability } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

export function noticeRoles(capability: Capability) {
  return MEMBER_ROLES.filter((role) => roleHasCapability(role, capability));
}

/** Gets member addresses from Supabase Auth for the notice’s capability. */
export async function billingRecipients(
  env: Env,
  companyId: string,
  db: SupabaseClient = getDb(env),
  capability: Capability = "billing.manage",
): Promise<string[]> {
  const { data, error } = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .is("deactivated_at", null)
    .in("role", noticeRoles(capability));
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
