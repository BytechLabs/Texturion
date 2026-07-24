import type { getDb } from "../../db";

import { unwrap } from "./http";

type Db = ReturnType<typeof getDb>;

/**
 * #191 attribution: resolve acting-member user-ids to their display names via a
 * single batched `profiles(user_id -> display_name)` lookup — the one mechanism
 * every attribution surface (contacts, calls, task detail) shares. Only a
 * resolved, non-empty display_name maps to a name, so an actor-less row (pre-#191
 * data) or a blank profile yields no entry and the UI omits the attribution line
 * rather than showing an empty one. Nulls/undefined and duplicates in the input
 * are de-duplicated; an empty input skips the query entirely.
 */
export async function resolveActorNames(
  db: Db,
  userIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(userIds.filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return names;
  const found = unwrap<{ user_id: string; display_name: string | null }[]>(
    await db.from("profiles").select("user_id,display_name").in("user_id", ids),
    "actor attribution profiles",
  );
  for (const p of found) {
    if (p.display_name) names.set(p.user_id, p.display_name);
  }
  return names;
}
