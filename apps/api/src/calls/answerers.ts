/**
 * #517 — who picked up, resolved at READ time.
 *
 * "Call answered" told a crew that somebody answered and left out the one
 * thing the rest of them wanted to know. The answerer was already recorded —
 * the state machine writes `calls.answered_by_user_id` at answer time — it
 * simply never reached the surfaces that render the call.
 *
 * WHY READ TIME, when stamping it into `api_thread_call`'s payload at insert
 * was the obvious move. Because that names the answerer on calls taken from
 * now on and leaves every call already in the product reading "Call answered"
 * forever — a thread that changes its mind halfway down, and a founder who
 * has to take a new call to see the fix. The join key is on rows that already
 * exist, so reading it back gives the whole history the same line. It also
 * drops a migration and an RPC signature bump from the change.
 *
 * BEST-EFFORT, ALWAYS. Every caller renders a line that is already correct
 * without this; the name only makes it more useful. So a failed lookup must
 * degrade to "Call answered" rather than 500 a page somebody is reading.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Only the two shapes that exist: a call's own id, or its session id. */
export type CallKeyColumn = "id" | "call_session_id";

/**
 * `key value -> answering user id`, for the keys that have one.
 *
 * Absent rather than null for an unanswered (or pre-#517) call, so callers add
 * the field only when there is something to say and every client needs one
 * branch instead of two.
 */
export async function answerersByCall(
  db: SupabaseClient,
  companyId: string,
  column: CallKeyColumn,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const answerers = new Map<string, string>();
  if (keys.length === 0) return answerers;

  const { data, error } = await db
    .from("calls")
    .select(`${column},answered_by_user_id`)
    .eq("company_id", companyId)
    .in(column, [...new Set(keys)]);
  if (error) {
    console.error(`call answerer lookup failed: ${error.message}`);
    return answerers;
  }

  for (const row of (data ?? []) as Record<string, string | null>[]) {
    const key = row[column];
    const userId = row.answered_by_user_id;
    if (typeof key === "string" && userId) answerers.set(key, userId);
  }
  return answerers;
}
