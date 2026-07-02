/**
 * Daily subscription reconcile (SPEC §11): a convergence backstop for missed
 * Stripe webhooks. For every non-`active` company that has a subscription,
 * re-fetch the subscription from Stripe and re-mirror status/plan/period
 * through the SAME `syncSubscription` path the §9 webhook handlers use — the
 * mirror is convergent, so re-running it is always safe. Also counts pending
 * invites past `expires_at` (report only — §11: acceptance already checks
 * expiry, so no state change is needed or wanted here).
 */
import { getDb } from "../db";
import type { Env } from "../env";
import { syncSubscription } from "../webhooks/stripe";

export interface SubscriptionReconcileSummary {
  /** Companies whose subscription was re-fetched and re-mirrored. */
  reconciled: number;
  /** Pending invites past expires_at (reported, never mutated). */
  staleInvites: number;
}

export async function runSubscriptionReconcileJob(
  env: Env,
  now: Date = new Date(),
): Promise<SubscriptionReconcileSummary> {
  const db = getDb(env);
  const summary: SubscriptionReconcileSummary = {
    reconciled: 0,
    staleInvites: 0,
  };

  const { data, error } = await db
    .from("companies")
    .select("id,stripe_subscription_id")
    .neq("subscription_status", "active")
    .not("stripe_subscription_id", "is", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`non-active companies lookup failed: ${error.message}`);
  }

  const failures: unknown[] = [];
  for (const row of (data ?? []) as {
    id: string;
    stripe_subscription_id: string;
  }[]) {
    try {
      await syncSubscription(env, row.stripe_subscription_id, db);
      summary.reconciled += 1;
    } catch (cause) {
      // One broken tenant must not starve the rest; rethrown below so the
      // cron run still reports failure (Sentry wraps scheduled()).
      failures.push(cause);
    }
  }

  // Stale-invite report (§11): count only — acceptance re-checks expiry and
  // the pending-invite seat formula already excludes expired rows.
  const { count, error: inviteError } = await db
    .from("invites")
    .select("id", { count: "exact", head: true })
    .is("accepted_at", null)
    .is("revoked_at", null)
    .lt("expires_at", now.toISOString());
  if (inviteError) {
    throw new Error(`stale invite count failed: ${inviteError.message}`);
  }
  summary.staleInvites = count ?? 0;
  if (summary.staleInvites > 0) {
    console.log(
      `subscription reconcile: ${summary.staleInvites} pending invite(s) past expires_at (report only)`,
    );
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `subscription reconcile failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
  return summary;
}
