/**
 * #694: one member's mute and follow on one conversation, as the senders read
 * them.
 *
 * MUTE silences push and email for new messages, missed calls and voicemails on
 * the thread. It never applies to a ringing call, an @mention or an assignment:
 * those are about the member, not about the thread, and their senders do not
 * call this module.
 *
 * FOLLOW adds the member to the audience of a thread that is assigned to
 * someone else. When a member both follows and mutes, mute wins.
 *
 * A past `muted_until` is over. Nothing sweeps rows, so the read side is the
 * only place that decides.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConversationMemberPref {
  user_id: string;
  muted: boolean;
  muted_until: string | null;
  followed: boolean;
}

export type ConversationPrefs = Map<string, ConversationMemberPref>;

export async function loadConversationPrefs(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<ConversationPrefs> {
  const result = await db
    .from("conversation_member_prefs")
    .select("user_id,muted,muted_until,followed")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId);
  // A failed read must not read as "nobody muted": that silently turns a broken
  // query into a notification somebody asked not to get. Throw and let the
  // sender's failure path own it.
  if (result.error) {
    throw new Error(`conversation prefs lookup failed: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as ConversationMemberPref[];
  return new Map(rows.map((row) => [row.user_id, row]));
}

export function isMuted(
  pref: ConversationMemberPref | undefined,
  now: number = Date.now(),
): boolean {
  if (!pref?.muted) return false;
  return pref.muted_until === null || Date.parse(pref.muted_until) > now;
}

/** Members who asked to hear about every message on this thread. */
export function followerIds(prefs: ConversationPrefs): string[] {
  return [...prefs.values()].filter((p) => p.followed).map((p) => p.user_id);
}

/** The audience with this thread's muted members taken out. */
export function withoutMuted(
  userIds: string[],
  prefs: ConversationPrefs,
  now: number = Date.now(),
): string[] {
  return userIds.filter((userId) => !isMuted(prefs.get(userId), now));
}

/**
 * The audience plus the followers who are allowed to see the thread.
 *
 * `viewers` is the #106 set: following never widens who may be told, so a
 * follower whose access to the number was later revoked is not added back.
 */
export function withFollowers(
  audience: string[],
  prefs: ConversationPrefs,
  viewers: string[],
): string[] {
  const allowed = new Set(viewers);
  const extra = followerIds(prefs).filter(
    (userId) => allowed.has(userId) && !audience.includes(userId),
  );
  return [...audience, ...extra];
}
