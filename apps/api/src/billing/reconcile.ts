/**
 * Daily subscription reconcile (SPEC §11): a convergence backstop for missed
 * Stripe webhooks. For every non-`active` company that has a subscription,
 * re-fetch the subscription from Stripe and re-mirror status/plan/period
 * through the SAME `syncSubscription` path the §9 webhook handlers use — the
 * mirror is convergent, so re-running it is always safe. Also counts pending
 * invites past `expires_at` (report only — §11: acceptance already checks
 * expiry, so no state change is needed or wanted here).
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { syncSubscription } from "../webhooks/stripe";
import { idempotencyKey } from "./idempotency";
import { getStripe } from "./stripe";

/**
 * §11 orphan-subscription safety net (mirrors reconcileNumbers' orphan-release).
 * Checkout attaches ONE live subscription per company and cancels a raced
 * duplicate INLINE (best-effort) in handleCheckoutCompleted; if that cancel
 * throws, a settled company keeps a SECOND live subscription that bills the
 * founder forever. This daily sweep reclaims it.
 *
 * - MIN_AGE buries the webhook race (a legit brand-new sub whose
 *   checkout.session.completed hasn't yet stamped stripe_subscription_id) — worst
 *   DB lag is the 5-min webhook_events sweeper + retries; 60 min has ample margin.
 * - COLLECTIBLE = the statuses that actually bill (hasLiveSubscription set), checked
 *   on the RAW Stripe status so 'trialing' is NOT laundered to 'active' and stays
 *   excluded from cancels; SETTLED (the stored sub must be one for the company to
 *   count as settled) additionally admits 'trialing'.
 */
const ORPHAN_SUBSCRIPTION_MIN_AGE_S = 3600;
const COLLECTIBLE_STATUSES = new Set(["active", "past_due", "unpaid"]);
const SETTLED_STATUSES = new Set(["active", "past_due", "unpaid", "trialing"]);

export interface SubscriptionReconcileSummary {
  /** Companies whose subscription was re-fetched and re-mirrored. */
  reconciled: number;
  /** Pending invites past expires_at (reported, never mutated). */
  staleInvites: number;
  /** §11: raced-duplicate subscriptions reclaimed (canceled). */
  orphanSubscriptionsCancelled: number;
  /** §11: ambiguous extra live subscriptions flagged for manual review (never auto-canceled). */
  orphanSubscriptionsFlagged: number;
}

export async function runSubscriptionReconcileJob(
  env: Env,
  now: Date = new Date(),
): Promise<SubscriptionReconcileSummary> {
  const db = getDb(env);
  const summary: SubscriptionReconcileSummary = {
    reconciled: 0,
    staleInvites: 0,
    orphanSubscriptionsCancelled: 0,
    orphanSubscriptionsFlagged: 0,
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

  // §11 orphan-subscription sweep — AFTER the re-mirror loop (so the DB status has
  // converged from Stripe) and BEFORE the stale-invite count.
  await sweepOrphanSubscriptions(env, db, now, summary, failures);

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

/**
 * Reclaim a raced-duplicate subscription that the inline checkout cancel missed.
 * For each SETTLED tenant (a company that has both a customer AND a stored
 * subscription), list the customer's Stripe subscriptions and cancel any extra
 * LIVE one that isn't the stored subscription — the only shape the double-buy
 * leak takes. Every guard below exists so a legitimate subscription is NEVER
 * cancelled:
 *   - the stored subscription (id === stored) is never a target;
 *   - the company must be SETTLED (its stored sub is itself live) — otherwise a
 *     missed activation webhook could point the DB at an old sub while the
 *     customer's REAL live sub is the non-stored one, so we FLAG, never cancel;
 *   - the extra sub must be >= MIN_AGE (buries the just-created-but-unmirrored race);
 *   - not cancel_at_period_end (already winding down — never fight a portal action);
 *   - COLLECTIBLE raw status only (trialing/incomplete/paused excluded).
 * A LIST failure reddens the run (pushed to failures[]); a CANCEL failure is
 * flagged + retried next sweep (NOT failures[], so one un-killable orphan can't
 * perpetually red the daily job — mirrors reconcileNumbers' orphan handling).
 */
async function sweepOrphanSubscriptions(
  env: Env,
  db: SupabaseClient,
  now: Date,
  summary: SubscriptionReconcileSummary,
  failures: unknown[],
): Promise<void> {
  const { data, error } = await db
    .from("companies")
    .select("id,stripe_customer_id,stripe_subscription_id")
    .not("stripe_customer_id", "is", null)
    .not("stripe_subscription_id", "is", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`orphan-sweep companies lookup failed: ${error.message}`);
  }

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const stripe = getStripe(env);

  for (const row of (data ?? []) as {
    id: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
  }[]) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: row.stripe_customer_id,
        limit: 100,
      });
      // A default listing excludes canceled/incomplete_expired. >100 live subs is
      // impossible for this product — a partial view we must never act on.
      if (subs.has_more) {
        Sentry.captureMessage(
          `subscription reconcile: customer ${row.stripe_customer_id} (company ${row.id}) returned >100 subscriptions — skipping orphan sweep (partial view)`,
          "warning",
        );
        continue;
      }
      const stored = subs.data.find(
        (s) => s.id === row.stripe_subscription_id,
      );
      const settled = stored != null && SETTLED_STATUSES.has(stored.status);

      for (const s of subs.data) {
        if (s.id === row.stripe_subscription_id) continue;
        if (!COLLECTIBLE_STATUSES.has(s.status)) continue;
        if (s.cancel_at_period_end === true) continue;
        if (nowEpoch - s.created < ORPHAN_SUBSCRIPTION_MIN_AGE_S) continue;

        if (!settled) {
          // The stored sub isn't confirmed live: the customer's live sub may be
          // this one. Never cancel a possibly-only subscription — page a human.
          summary.orphanSubscriptionsFlagged += 1;
          Sentry.captureMessage(
            `subscription reconcile: company ${row.id} (customer ${row.stripe_customer_id}) has a live subscription ${s.id} that is NOT its stored subscription (${row.stripe_subscription_id}), and the stored subscription is not confirmed live — NOT auto-cancelling; manual review needed.`,
            "error",
          );
          continue;
        }
        try {
          await stripe.subscriptions.cancel(s.id, undefined, {
            // Derived key: a same-day partial-failure rerun REPLAYS the cancel
            // rather than erroring on an already-cancelled sub.
            idempotencyKey: idempotencyKey(row.id, "orphan_cancel", s.id),
          });
          summary.orphanSubscriptionsCancelled += 1;
          Sentry.captureMessage(
            `subscription reconcile: cancelled orphan subscription ${s.id} for company ${row.id} (customer ${row.stripe_customer_id}) — a settled company held an extra live subscription; stored subscription ${row.stripe_subscription_id} is the one-per-company invariant. Cancel stops future billing only — refund any duplicate invoice manually.`,
            "warning",
          );
        } catch (cancelError) {
          summary.orphanSubscriptionsFlagged += 1;
          Sentry.captureException(cancelError);
          Sentry.captureMessage(
            `subscription reconcile: failed to cancel orphan subscription ${s.id} for company ${row.id} — flagged, will retry next sweep.`,
            "error",
          );
        }
      }
    } catch (cause) {
      // A LIST failure for one tenant reddens the run without starving siblings.
      failures.push(cause);
    }
  }
}
