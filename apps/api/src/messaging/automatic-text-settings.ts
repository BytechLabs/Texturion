import {
  AUTOMATIC_TEXT_DEFAULTS,
  AUTOMATIC_TEXT_KEYS,
  type AutomaticTextSettings,
  resolveAutomaticTextSettings,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One workspace's automatic-text settings.
 *
 * A failed read returns the defaults, which are the behaviour workspaces had
 * before these were settings. The callers are best-effort paths (queuing a
 * reminder, a rating question, a scheduled text) where an unreadable setting
 * must not block the person's action.
 */
export async function loadAutomaticTextSettings(
  db: SupabaseClient,
  companyId: string,
): Promise<AutomaticTextSettings> {
  const { data, error } = await db
    .from("companies")
    .select(AUTOMATIC_TEXT_KEYS.join(","))
    .eq("id", companyId)
    .limit(1);
  if (error) {
    console.error(`automatic text settings read failed, using defaults: ${error.message}`);
    return resolveAutomaticTextSettings(null);
  }
  return resolveAutomaticTextSettings(
    ((data ?? [])[0] ?? null) as unknown as Partial<AutomaticTextSettings> | null,
  );
}

/** Seconds between automatic replies on one conversation. */
export function autoReplyThrottleSeconds(minutes: number | null | undefined): number {
  const chosen = typeof minutes === "number" ? minutes : AUTOMATIC_TEXT_DEFAULTS.auto_reply_cooldown_minutes;
  return chosen * 60;
}
