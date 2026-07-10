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
import { convergeExtraNumberQuantity } from "./extra-numbers";
import { retiredModulePrices } from "./modules";
import type { PlanId } from "./plans";
import { applyPriceToSchedulePhases } from "./schedule-phases";
import { getStripe, type Stripe } from "./stripe";

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
  /** #103: retired-module line items stripped (with prorated credit). */
  retiredModuleItemsRemoved: number;
  /** #105: extra-number quantities converged onto the count formula. */
  extraNumberQuantitiesConverged: number;
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
    retiredModuleItemsRemoved: 0,
    extraNumberQuantitiesConverged: 0,
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
    .select("id,plan,stripe_customer_id,stripe_subscription_id")
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
    plan: PlanId | null;
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

      // #103: strip line items priced on a RETIRED module (mms) from the stored
      // subscription — the module no longer exists, so a subscriber still
      // carrying its $5 item would be billed for nothing, forever, with no
      // self-serve way off (the catalog toggle is gone). Prorated credit
      // refunds the unused remainder. Idempotent: once removed, the item never
      // matches again; a lost race with an already-deleted item is treated as
      // done. Never touches non-retired prices, never runs on a non-stored sub.
      if (stored) {
        await stripRetiredModuleItems(env, stripe, row.id, stored, summary, now);
      }

      // #105 backstop: converge the extra-number billing DOWN onto the formula
      // (max(0, numbers − included)) — credits a crashed buy/release half and
      // migrates a wrong-plan item stranded by an upgrade. NEVER charges
      // upward: a count above what's billed (D16 port bridges, mid-port rows,
      // pending-downgrade adds, data anomalies) is FLAGGED for a human — an
      // automated "correction" there would be an unconsented charge. Live
      // stored subs only; schedule-managed ones settle after their rollover.
      // A failure is flagged + retried tomorrow, never reddening the run.
      if (stored && row.plan && SETTLED_STATUSES.has(stored.status)) {
        try {
          const converged = await convergeExtraNumberQuantity({
            env,
            db,
            stripe,
            companyId: row.id,
            plan: row.plan,
            stripeSubscriptionId: row.stripe_subscription_id,
            // #110: converge retrieves the subscription ITSELF, after reading
            // the raise-fence epoch — a pre-fetched snapshot would predate the
            // fence and could sync a stale billed value over a claimed credit.
            now,
          });
          if (converged?.kind === "lowered" || converged?.kind === "migrated") {
            summary.extraNumberQuantitiesConverged += 1;
            Sentry.captureMessage(
              `subscription reconcile: ${converged.kind === "migrated" ? "migrated a wrong-plan extra-number item" : "lowered the extra-number quantity"} to ${converged.quantity} for company ${row.id} (#105 down-only convergence).`,
              "warning",
            );
          } else if (converged?.kind === "over_included_unbilled") {
            Sentry.captureMessage(
              `subscription reconcile: company ${row.id} holds ${converged.desired - converged.billed} more number(s) than its billed extras (billed ${converged.billed}, formula ${converged.desired}) — NOT auto-charging (#105 down-only rule; likely a D16 port bridge or mid-port row). Review manually if it persists past the port window.`,
              "warning",
            );
          }
        } catch (cause) {
          Sentry.captureException(cause);
          Sentry.captureMessage(
            `subscription reconcile: extra-number convergence failed for company ${row.id} — will retry next sweep.`,
            "error",
          );
        }
      }

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

/**
 * #103: remove line items priced on a RETIRED module from a company's stored
 * subscription, with a prorated credit for the unused remainder. Today that is
 * the $5 "Picture messages" (mms) item — the module left the catalog (pictures
 * are free, metered as segments), so any surviving item bills the customer for
 * nothing with no self-serve off-switch. Convergent: once stripped, the price
 * never matches again; an item deleted elsewhere (raced sweep, manual dashboard
 * removal) surfaces as `resource_missing` and is treated as done. A subscription
 * always keeps its base licensed + metered items, so this can never empty one.
 * A failure is flagged + retried next sweep, never reddening the run (mirrors
 * the orphan-cancel posture).
 *
 * SCHEDULE-AWARE (#18): a pending-downgrade subscription schedule OWNS the
 * subscription's items — Stripe rejects a direct item delete, and even a landed
 * one would be undone when the schedule's pinned phase items re-apply (the
 * pre-#103 downgrade path pinned the mms price into BOTH phases). For a
 * schedule-managed subscription the retired price is instead stripped from
 * every remaining phase (the current-phase change updates the live
 * subscription with a prorated credit), exactly how the module toggle handles
 * schedules.
 */
async function stripRetiredModuleItems(
  env: Env,
  stripe: Stripe,
  companyId: string,
  stored: Stripe.Subscription,
  summary: SubscriptionReconcileSummary,
  now: Date,
): Promise<void> {
  const retired = retiredModulePrices(env);
  if (retired.length === 0) return; // price never provisioned here — no-op

  if (stored.items?.has_more) {
    // >10 items is impossible for this product — a partial view we must never
    // act on (mirrors the >100-subscriptions guard above).
    Sentry.captureMessage(
      `subscription reconcile: subscription ${stored.id} (company ${companyId}) returned a partial items list — skipping retired-item sweep`,
      "warning",
    );
    return;
  }

  const scheduleId =
    typeof stored.schedule === "string" ? stored.schedule : stored.schedule?.id;
  // Date-scoped key: one fresh attempt per daily sweep (a same-day rerun
  // replays; yesterday's cached FAILURE is never replayed as today's result).
  const day = now.toISOString().slice(0, 10);

  for (const item of stored.items?.data ?? []) {
    if (!item.price || !retired.includes(item.price.id)) continue;
    try {
      if (scheduleId) {
        // Rebuild every remaining phase without the retired price — the only
        // mutation Stripe accepts on a schedule-managed subscription, and the
        // only one the schedule's pinned phases won't undo at rollover.
        await applyPriceToSchedulePhases(
          stripe,
          scheduleId,
          item.price.id,
          false,
          "create_prorations",
        );
      } else {
        await stripe.subscriptionItems.del(
          item.id,
          { proration_behavior: "create_prorations" },
          { idempotencyKey: idempotencyKey(companyId, "retired_item", item.id, day) },
        );
      }
      summary.retiredModuleItemsRemoved += 1;
      Sentry.captureMessage(
        `subscription reconcile: removed retired-module item ${item.id} (price ${item.price.id}) from ${scheduleId ? `schedule ${scheduleId} phases of ` : ""}subscription ${stored.id} for company ${companyId} — the mms module is retired (#103); the unused remainder was credited via proration.`,
        "warning",
      );
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === "resource_missing") continue; // already gone — done
      Sentry.captureException(cause);
      Sentry.captureMessage(
        `subscription reconcile: failed to remove retired-module item ${item.id} from subscription ${stored.id} for company ${companyId} — will retry next sweep.`,
        "error",
      );
    }
  }
}
