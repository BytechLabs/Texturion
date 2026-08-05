/**
 * Daily subscription reconcile (SPEC §11): a convergence backstop for missed
 * Stripe webhooks. Re-fetch the subscription from Stripe and re-mirror
 * status/plan/period through the SAME `syncSubscription` path the §9 webhook
 * handlers use — the mirror is convergent, so re-running it is always safe.
 *
 * Three scans feed that loop, and each exists because the ones before it cannot
 * see the fault it catches:
 *   1. every non-`active` company with a subscription (the original §11 scan);
 *   2. every `active` company whose mirrored period has already ended — a
 *      renewal webhook that never landed, which pins every billing read to last
 *      month;
 *   3. #277: every company mirrored as PAUSED. A pause leaves the subscription
 *      genuinely active with a fresh period, so a paused workspace appears in
 *      neither scan above and nothing re-read it at all.
 *
 * Also counts pending invites past `expires_at` (report only — §11: acceptance
 * already checks expiry, so no state change is needed or wanted here).
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { subscriptionPause, syncSubscription } from "../webhooks/stripe";
import { idempotencyKey } from "./idempotency";
import { convergeExtraNumberQuantity } from "./extra-numbers";
import { retiredModulePrices } from "./modules";
import { ensureVoiceMeteredItem } from "../webhooks/stripe";
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

/**
 * Per-run scan caps. A single Workers invocation is bounded to ~1000
 * subrequests, and a PostgREST read silently truncates at the 1000-row default,
 * so an unbounded per-company scan either crashes partway (leaving the tail
 * unreconciled at the SAME place every run) or drops tenants with no error.
 * Each scan below is ordered + capped; the orphan sweep issues up to ~4 Stripe
 * subrequests per company (list + retrieve + item ops), so it takes the tighter
 * cap. If a scan hits its cap we alert — the base has outgrown one run and
 * checkpoint-resume should be added before the tail is missed.
 */
const RECONCILE_REMIRROR_BATCH = 500;
const ORPHAN_SWEEP_BATCH = 200;

function warnIfScanAtCapacity(count: number, batch: number, scan: string): void {
  if (count >= batch) {
    Sentry.captureMessage(
      `reconcile ${scan} scan hit its per-run cap of ${batch}; the tail is NOT processed this run — add checkpoint-resume before the base outgrows one invocation`,
      "warning",
    );
  }
}
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
    // Canceled tenants keep their stripe_subscription_id FOREVER, so including
    // them grows this scan with lifetime churn — and re-mirroring a canceled sub
    // is a no-op (Stripe returns canceled; a resubscribe is a NEW sub handled by
    // checkout webhooks). Exclude them; the remaining non-active states
    // (past_due/unpaid/incomplete) are transient + recoverable — the actual
    // reconcile target (a missed webhook that left texting wrongly paused).
    .neq("subscription_status", "canceled")
    .not("stripe_subscription_id", "is", null)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(RECONCILE_REMIRROR_BATCH);
  if (error) {
    throw new Error(`non-active companies lookup failed: ${error.message}`);
  }
  warnIfScanAtCapacity(
    (data ?? []).length,
    RECONCILE_REMIRROR_BATCH,
    "re-mirror",
  );

  // Plus any ACTIVE company whose mirrored period has already ended.
  //
  // The scan above deliberately skips active tenants, and nothing else
  // re-mirrors them: the period columns are written only by a live renewal
  // webhook, and the webhook sweeper abandons a row after five attempts. A
  // Stripe outage across a renewal therefore pins the period to last month
  // permanently, and EVERY billing read is anchored on it — the send cap sums
  // two months of usage against one month's ceiling and starts refusing texts
  // for a crew that is well inside its plan.
  //
  // An expired period is exactly the detectable symptom, so this is bounded by
  // the fault rather than by status: empty on a healthy day.
  const { data: staleActive, error: staleError } = await db
    .from("companies")
    .select("id,stripe_subscription_id")
    .eq("subscription_status", "active")
    .not("stripe_subscription_id", "is", null)
    .not("current_period_end", "is", null)
    .lt("current_period_end", now.toISOString())
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(RECONCILE_REMIRROR_BATCH);
  if (staleError) {
    throw new Error(`stale-period lookup failed: ${staleError.message}`);
  }
  warnIfScanAtCapacity(
    (staleActive ?? []).length,
    RECONCILE_REMIRROR_BATCH,
    "stale-period re-mirror",
  );

  // #277: plus every workspace this database says is PAUSED.
  //
  // A pause leaves the subscription genuinely `active` and its period fresh, so
  // a paused company is in NEITHER scan above — and no other job re-reads it.
  // The pause column's own comment claimed it converged "within a day"; until
  // this scan existed, nothing re-read a paused workspace at all.
  //
  // `paused_at` is a SEND GATE, so being stuck on the wrong side of it is not a
  // reporting inaccuracy. The states this heals are all shapes of the same
  // thing — Stripe took the money and our mirror did not land:
  //   * POST /v1/billing/resume swaps the price back and THEN mirrors; if that
  //     mirror throws (a PostgREST blip is enough) the customer has been charged
  //     back up to the plan price and stays blocked, and the resume button now
  //     409s because the subscription no longer carries a pause item to swap.
  //     There is no self-serve way out of that; this scan is the way out.
  //   * a resume or a repricing done in the Stripe dashboard.
  //   * any future path that attaches a subscription and forgets this column.
  //
  // Bounded by the paused cohort rather than by a fault, which is affordable
  // precisely because the cohort is small by construction: every row in it is a
  // workspace paying a holding fee, and each costs one subscription retrieve a
  // day. Capped and alerted like the scans above.
  const { data: pausedActive, error: pausedError } = await db
    .from("companies")
    .select("id,stripe_subscription_id")
    .eq("subscription_status", "active")
    .not("paused_at", "is", null)
    .not("stripe_subscription_id", "is", null)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(RECONCILE_REMIRROR_BATCH);
  if (pausedError) {
    throw new Error(`paused-company lookup failed: ${pausedError.message}`);
  }
  warnIfScanAtCapacity(
    (pausedActive ?? []).length,
    RECONCILE_REMIRROR_BATCH,
    "paused re-mirror",
  );

  // One target list, de-duplicated by company id: the scans deliberately
  // overlap (a paused workspace whose period also expired is in two of them),
  // and syncSubscription is convergent, so a repeat would be correct but would
  // pay a second Stripe retrieve and a second write to say the same thing.
  const seenIds = new Set<string>();
  const remirrorTargets: { id: string; stripe_subscription_id: string }[] = [];
  for (const scan of [data, staleActive, pausedActive]) {
    for (const row of (scan ?? []) as {
      id: string;
      stripe_subscription_id: string;
    }[]) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      remirrorTargets.push(row);
    }
  }

  const failures: unknown[] = [];
  for (const row of remirrorTargets) {
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
 *
 * The one list call this makes per tenant has become the cheapest place in the
 * product to ask what a subscription's items actually say, so two convergences
 * ride it: #103's retired-item strip, and #277's pause fact (below). Neither
 * costs a Stripe request unless something is genuinely out of step.
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
    // #277: paused_price_cents rides along so the pause convergence at the foot
    // of this loop can tell "already correct" from "needs a write" — the founder
    // can reprice the pause, and the #85 margin report reads that column.
    .select(
      "id,plan,paused_at,paused_price_cents,stripe_customer_id,stripe_subscription_id",
    )
    .not("stripe_customer_id", "is", null)
    .not("stripe_subscription_id", "is", null)
    .is("deleted_at", null)
    // Bounded per-run: each company issues up to ~4 Stripe subrequests, so a
    // full unbounded paying-base scan would blow the ~1000 subrequest ceiling
    // (or silently truncate at the PostgREST 1000-row default) as the base grows.
    .order("id", { ascending: true })
    .limit(ORPHAN_SWEEP_BATCH);
  if (error) {
    throw new Error(`orphan-sweep companies lookup failed: ${error.message}`);
  }
  warnIfScanAtCapacity((data ?? []).length, ORPHAN_SWEEP_BATCH, "orphan-sweep");

  const nowEpoch = Math.floor(now.getTime() / 1000);
  const stripe = getStripe(env);

  for (const row of (data ?? []) as {
    id: string;
    plan: PlanId | null;
    paused_at: string | null;
    paused_price_cents: number | null;
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

      /**
       * #277 — what THIS subscription says about the pause, read from the items
       * the list call above already returned. No extra Stripe request on the
       * healthy path, which is what makes checking every swept tenant every day
       * affordable.
       *
       * Used twice: to decide the extra-number skip on Stripe's truth rather
       * than on a mirror that may be the very thing that is wrong, and to
       * converge the mirror at the foot of this loop.
       *
       * `unknown` (neither a pause price nor a plan price is recognisable —
       * the shape of a deploy that lost STRIPE_PAUSE_PRICE_ID) falls back to
       * the stored fact, because a fact we cannot currently read is not a fact
       * that changed. Same three-answer discipline as the mirror itself.
       *
       * An absent or PARTIAL item list is read as `unknown` too, for the same
       * reason stripRetiredModuleItems skips one: a view we know is incomplete
       * is not evidence about what is on the subscription. (`items` is typed as
       * always present, but this listing is the one place the shape is not
       * ours to guarantee — the retired-item sweep below already guards it.)
       */
      const pause =
        stored && stored.items && !stored.items.has_more
          ? subscriptionPause(env, stored)
          : { reading: "unknown" as const, priceCents: null };
      const pausedNow =
        pause.reading === "unknown"
          ? (row.paused_at ?? null) !== null
          : pause.reading === "paused";

      // #103: strip line items priced on a RETIRED module (mms) from the stored
      // subscription — the module no longer exists, so a subscriber still
      // carrying its $5 item would be billed for nothing, forever, with no
      // self-serve way off (the catalog toggle is gone). Prorated credit
      // refunds the unused remainder. Idempotent: once removed, the item never
      // matches again; a lost race with an already-deleted item is treated as
      // done. Never touches non-retired prices, never runs on a non-stored sub.
      if (stored) {
        await stripRetiredModuleItems(env, stripe, row.id, stored, summary, now);
        // #134/D42 review fix: the voice metered item must reach QUIET active
        // subscriptions too — webhook mirror passes only fire on Stripe
        // events, so without this daily converge a pre-D42 subscriber's
        // overage would go unbilled until their next natural webhook (up to
        // a full cycle). Fails toward unbilled, logged inside. (Known
        // bounded gap: a pre-D42 PENDING-DOWNGRADE schedule owns its items
        // and is skipped — it self-heals when the schedule releases at
        // period end; fails toward unbilled, customer-favorable.)
        await ensureVoiceMeteredItem(env, row.id, stored);
      }

      // #105 backstop: converge the extra-number billing DOWN onto the formula
      // (max(0, numbers − included)) — credits a crashed buy/release half and
      // migrates a wrong-plan item stranded by an upgrade. NEVER charges
      // upward: a count above what's billed (D16 port bridges, mid-port rows,
      // pending-downgrade adds, data anomalies) is FLAGGED for a human — an
      // automated "correction" there would be an unconsented charge. Live
      // stored subs only; schedule-managed ones settle after their rollover.
      // A failure is flagged + retried tomorrow, never reddening the run.
      //
      // #277: SKIPPED WHILE PAUSED, and the reason is that `row.plan` stops
      // being the right input. During a pause the licensed line is the pause
      // price and `companies.plan` holds the plan the workspace will RESUME
      // onto — so the formula's `included` term (PLAN_LIMITS[plan].numbers)
      // describes a plan nobody is currently paying for. There is no "included
      // numbers" figure for a pause price to converge against; the holding fee
      // covers the base and the extra-number line stays exactly as it is,
      // which is right — a paused workspace still holds those numbers and we
      // still pay Telnyx rent on every one of them.
      //
      // Skipping is also the conservative arm under this function's own
      // down-only rule: the honest answer to "what should the extras be for a
      // plan that is not in effect" is that we do not know, and #105 already
      // says an uncertain quantity is flagged for a human rather than written.
      // The next daily sweep after a resume converges it normally.
      //
      // Decided on `pausedNow` — the subscription's OWN licensed item — rather
      // than on the mirrored column: this sweep exists for the case where the
      // mirror is stale, and reading the stale value here would let a pause
      // Stripe already knows about be converged as though it were a plan.
      if (stored && row.plan && !pausedNow && SETTLED_STATUSES.has(stored.status)) {
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

      // #277 — the pause fact, converged from the subscription's own licensed
      // item. The other half of the claim on `companies.paused_at`: the paused
      // re-mirror scan covers every workspace we ALREADY believe is paused, and
      // this covers the direction that scan cannot see — a workspace paused (or
      // repriced) at Stripe that our mirror still reads as running.
      //
      // That direction is the one every `paused_at ?? null` coalesce in the
      // product leans on. getSendGates and routes/calls.ts both read a missing
      // value as "not paused" — deliberately, because a wrong "paused" would
      // refuse a paying crew's texts and calls — and both say the next mirror
      // pass writes the fact back. Without this check nothing did, for an active
      // workspace with a fresh period.
      //
      // LAST in the loop, and through syncSubscription rather than a direct
      // write: last so a throw here cannot cost this tenant its orphan cancels,
      // and through the mirror so `paused_at` keeps exactly one writer. A throw
      // reddens the run (the outer catch), which is the right noise for a send
      // gate that could not be corrected.
      const stale =
        pause.reading === "paused"
          ? (row.paused_at ?? null) === null ||
            (row.paused_price_cents ?? null) !== pause.priceCents
          : pause.reading === "not_paused"
            ? (row.paused_at ?? null) !== null ||
              (row.paused_price_cents ?? null) !== null
            : false;
      if (stale) {
        await syncSubscription(env, row.stripe_subscription_id, db);
        summary.reconciled += 1;
        Sentry.captureMessage(
          `subscription reconcile: company ${row.id} was mirrored as ${row.paused_at ? "paused" : "not paused"} while subscription ${row.stripe_subscription_id} carries a ${pause.reading === "paused" ? "PAUSE" : "PLAN"} licensed price — re-mirrored (#277). A missed subscription webhook, or a mirror write that never landed.`,
          "warning",
        );
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
