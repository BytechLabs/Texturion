/**
 * #224 — retire the payment requests nobody paid.
 *
 * A request has a hard expiry (14 days, the D75 rule that a public link must
 * have one) and the D75 token stops resolving on its own. What does NOT happen
 * on its own is the row changing: without this the thread would keep showing
 * "Waiting" for a link that no longer opens, so a crew chases a customer over a
 * page that already told them to ask for a new one.
 *
 * The Stripe payment link is deliberately NOT deactivated here. It is only
 * reachable through our token, which has already expired, and calling Stripe
 * once per expired request would turn a single SQL statement into an unbounded
 * fan-out of network calls inside a cron — for an object nobody can reach.
 * Cancelling by hand still deactivates it, because that is the path where
 * somebody might have the Stripe URL from a browser tab.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

/**
 * How many to retire per pass.
 *
 * Hourly, so 500 is far above any real backlog. It exists for the shape of the
 * problem rather than the size of it: an unbounded UPDATE in a cron is one bad
 * import away from being the statement that locks the table.
 */
const EXPIRE_BATCH = 500;

export async function expirePaymentRequests(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("expire_payment_requests", {
    p_limit: EXPIRE_BATCH,
  });
  if (error) {
    throw new Error(`payment request expiry failed: ${error.message}`);
  }
  const expired = (data as number) ?? 0;
  if (expired > 0) {
    console.log(`expired ${expired} payment request(s)`);
  }
  return expired;
}
