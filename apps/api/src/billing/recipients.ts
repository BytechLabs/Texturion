import { MEMBER_ROLES, resolveLocale, roleHasCapability, type Capability, type Locale } from "@loonext/shared";
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
  const users = await billingRecipientUsers(db, companyId, capability);
  return users.map((user) => user.email);
}

export async function billingRecipientsByLocale(
  db: SupabaseClient,
  companyId: string,
  companyLocale: string | null | undefined,
): Promise<Map<Locale, string[]>> {
  const users = await billingRecipientUsers(db, companyId, "billing.manage");
  const groups = new Map<Locale, string[]>();
  if (users.length === 0) return groups;
  const { data, error } = await db
    .from("profiles")
    .select("user_id,locale")
    .in("user_id", users.map((user) => user.id));
  if (error) throw new Error(`billing recipient locale lookup failed: ${error.message}`);
  const preferences = new Map((data ?? []).map((profile) => [profile.user_id, profile.locale]));
  for (const user of users) {
    const locale = resolveLocale(preferences.get(user.id), user.locale ?? companyLocale);
    const recipients = groups.get(locale) ?? [];
    recipients.push(user.email);
    groups.set(locale, recipients);
  }
  return groups;
}

async function billingRecipientUsers(db: SupabaseClient, companyId: string, capability: Capability) {
  const { data, error } = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .is("deactivated_at", null)
    .in("role", noticeRoles(capability));
  if (error) {
    throw new Error(`company_members lookup failed: ${error.message}`);
  }

  const users: { id: string; email: string; locale: Locale | null }[] = [];
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
    const preference: unknown = userData.user?.user_metadata?.locale;
    if (email) {
      users.push({
        id: userId,
        email,
        locale: preference === "fr-CA" || preference === "en" ? preference : null,
      });
    }
  }
  return users;
}
