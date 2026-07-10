/**
 * #105 (#80): paid EXTRA phone numbers beyond the plan's included count.
 *
 * Pricing (founder decision, #80): Starter $5/mo per extra with a HARD total
 * cap of 2 numbers (1 included + 1 extra); Pro $4/mo per extra, unlimited
 * extras (2 included). US numbers only, and only for companies with US texting
 * enabled. The message quota is per-company and SHARED across all numbers —
 * an extra number never adds quota (the UI says so plainly).
 *
 * BILLING MODEL — one licensed Stripe price per plan, quantity = the number of
 * PAID extras, kept CONVERGENT with the truth in the DB:
 *
 *   desired quantity = max(0, nonReleasedNumbers − planIncluded)
 *
 * - BUY (provision route, at the included cap): quantity is bumped to cover
 *   count+1 BEFORE the slot claim, with the request's Idempotency-Key deriving
 *   the Stripe key — a retry can never double-charge. If the order later dies,
 *   the paid capacity is NOT lost: the slot stays open (allowance > count) and
 *   the existing remediation flow fills it without a new charge.
 * - RELEASE + the daily reconcile: quantity converges DOWN-ONLY to the formula
 *   (prorated credit). Convergence NEVER raises a quantity or creates an item:
 *   legitimate free over-included states exist (the D16 port bridge number, a
 *   ported row mid-port, an included slot added during a pending downgrade),
 *   so an upward "correction" would be an unconsented charge. When the count
 *   exceeds what's billed, convergence FLAGS it (Sentry) for a human instead —
 *   the only path that raises a quantity is the explicit buy above.
 * - UPGRADE starter→pro: the change-plan path swaps a surviving extra item to
 *   the Pro price; convergence also migrates a wrong-plan-price item it finds
 *   (equal quantity, prorated) so a stranded $5 Starter item can never bill
 *   forever after an upgrade.
 * - SCHEDULE-MANAGED subscriptions (a pending downgrade owns the items, #18):
 *   buys are REFUSED with a clear message (finish the plan change first), and
 *   convergence is skipped until the schedule releases — the day-after
 *   reconcile then settles the quantity. Rare, bounded, honest.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { idempotencyKey } from "./idempotency";
import { PLAN_LIMITS, type PlanId } from "./plans";
import type { Stripe } from "./stripe";

/** Monthly price per extra number, in cents (#80: $5 Starter, $4 Pro). */
export const EXTRA_NUMBER_MONTHLY_CENTS: Record<PlanId, number> = {
  starter: 500,
  pro: 400,
};

/** Starter's hard TOTAL number cap: 1 included + at most 1 extra (#80). */
export const STARTER_MAX_TOTAL_NUMBERS = 2;

/** The plan's extra-number Stripe price id, or null when not provisioned —
 *  then extras are simply not purchasable in this environment (fail CLOSED:
 *  never a free extra). */
export function extraNumberPrice(env: Env, plan: PlanId): string | null {
  return (
    (plan === "starter"
      ? env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID
      : env.STRIPE_EXTRA_NUMBER_PRO_PRICE_ID) ?? null
  );
}

/** The convergence formula: paid extras a company should be billed for. */
export function desiredExtraQuantity(
  nonReleasedNumbers: number,
  plan: PlanId,
): number {
  return Math.max(0, nonReleasedNumbers - PLAN_LIMITS[plan].numbers);
}

/** The total numbers a company may hold: plan-included + paid extras. */
export function effectiveNumberAllowance(
  plan: PlanId,
  paidExtras: number,
): number {
  return PLAN_LIMITS[plan].numbers + paidExtras;
}

// #110 note: the #108-era `currentPaidExtras` Stripe read is gone — the port /
// text-enablement routes no longer read Stripe at all. Paid capacity lives in
// companies.paid_extra_numbers (mirrored by syncPaidExtraCapacity below and
// consumed by the slot RPCs under their company-row lock), which closed the
// admit-vs-converge race that Stripe-read approach carried.

/** May this company buy ONE MORE number beyond `currentCount`? (#80 rules.) */
export function extraNumberPurchasable(args: {
  plan: PlanId;
  currentCount: number;
  country: string;
  usTextingEnabled: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (args.country !== "US" || !args.usTextingEnabled) {
    return {
      ok: false,
      reason:
        "Extra numbers are US numbers and need US texting enabled on your account first.",
    };
  }
  if (
    args.plan === "starter" &&
    args.currentCount >= STARTER_MAX_TOTAL_NUMBERS
  ) {
    return {
      ok: false,
      reason: `Starter tops out at ${STARTER_MAX_TOTAL_NUMBERS} numbers (1 included + 1 extra). Move to Pro for more.`,
    };
  }
  return { ok: true };
}

/** Count the company's numbers that still cost us rent (not released). */
export async function countNonReleasedNumbers(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count, error } = await db
    .from("phone_numbers")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .neq("status", "released");
  if (error) throw new Error(`phone_numbers count failed: ${error.message}`);
  return count ?? 0;
}

/** The subscription's current extra-number item (by the plan's price). */
export function findExtraNumberItem(
  subscription: Stripe.Subscription,
  price: string,
): Stripe.SubscriptionItem | undefined {
  return subscription.items?.data?.find((item) => item.price?.id === price);
}

/** BOTH plans' extra-number prices configured in this environment. */
export function allExtraNumberPrices(env: Env): string[] {
  return [
    env.STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID,
    env.STRIPE_EXTRA_NUMBER_PRO_PRICE_ID,
  ].filter((price): price is string => typeof price === "string" && price.length > 0);
}

/**
 * Set the subscription's extra-number quantity to `quantity` (create / update /
 * delete the item as needed). `proration` decides when the difference bills:
 * `always_invoice` for a BUY (the charge lands now — the customer sees what
 * they pay before the number exists), `create_prorations` for convergence
 * (the credit/charge rides the next invoice). No-ops when already converged.
 * Refuses schedule-managed subscriptions (the caller decides what that means).
 */
export async function setExtraNumberQuantity(args: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
  price: string;
  quantity: number;
  proration: "always_invoice" | "create_prorations";
  idempotencyKey: string;
}): Promise<{ applied: boolean }> {
  const { stripe, subscription, price, quantity, proration } = args;
  if (subscription.schedule) {
    throw new ScheduleManagedSubscriptionError(subscription.id);
  }
  const item = findExtraNumberItem(subscription, price);
  const current = item?.quantity ?? 0;
  if (current === quantity) return { applied: false };

  if (!item) {
    await stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price,
        quantity,
        proration_behavior: proration,
      },
      { idempotencyKey: args.idempotencyKey },
    );
  } else if (quantity === 0) {
    await stripe.subscriptionItems.del(
      item.id,
      { proration_behavior: proration },
      { idempotencyKey: args.idempotencyKey },
    );
  } else {
    await stripe.subscriptionItems.update(
      item.id,
      { quantity, proration_behavior: proration },
      { idempotencyKey: args.idempotencyKey },
    );
  }
  return { applied: true };
}

/** Thrown when a quantity change hits a schedule-managed subscription (#18). */
export class ScheduleManagedSubscriptionError extends Error {
  constructor(subscriptionId: string) {
    super(
      `subscription ${subscriptionId} is schedule-managed — extra-number quantity changes must wait for the schedule to release`,
    );
    this.name = "ScheduleManagedSubscriptionError";
  }
}

export type ConvergeOutcome =
  | { kind: "noop"; quantity: number }
  | { kind: "lowered"; quantity: number }
  | { kind: "migrated"; quantity: number }
  /** The count exceeds what's billed — NEVER auto-charged (a legitimate free
   *  over-included state, e.g. a D16 port bridge, or a data anomaly). The
   *  caller flags it for a human. */
  | { kind: "over_included_unbilled"; billed: number; desired: number };

/**
 * CONVERGE the extra-number billing toward the formula for one company (used
 * by the release path, the change-plan path, and the daily reconcile) —
 * STRICTLY DOWN-ONLY:
 *
 *   - a billed quantity ABOVE the formula is lowered/removed (prorated
 *     credit — heals a crashed buy or release half);
 *   - an item on the WRONG plan's price (a starter item surviving an upgrade)
 *     is migrated to the current plan's price at min(quantity, desired) so it
 *     can never bill forever invisibly;
 *   - a count ABOVE what's billed is REPORTED, never charged: legitimate free
 *     over-included states exist (D16 port bridges, mid-port rows, an included
 *     slot added during a pending downgrade), so raising a quantity here would
 *     be an unconsented charge. Quantity only ever rises in the explicit buy.
 *
 * Skips (null) when the price isn't provisioned or the subscription is
 * schedule-managed (#18 — settled by the first reconcile after rollover).
 * Stripe idempotency keys are scoped to the ITEM + target quantity + day, so
 * same-day transitions against different items never replay each other.
 */
export async function convergeExtraNumberQuantity(args: {
  env: Env;
  db: SupabaseClient;
  stripe: Stripe;
  companyId: string;
  plan: PlanId;
  stripeSubscriptionId: string;
  /** Date scoping for the Stripe idempotency key (one attempt per day). */
  now: Date;
}): Promise<ConvergeOutcome | null> {
  const price = extraNumberPrice(args.env, args.plan);
  if (!price) return null;

  // #110 ORDER MATTERS: read the raise-fence epoch BEFORE the subscription
  // snapshot. Any claim (an inline release-converge racing this run) that
  // lands after this read bumps the epoch, so a sync raise formed from the
  // snapshot below is refused instead of resurrecting credited capacity. The
  // subscription is therefore always retrieved FRESH here — a caller-provided
  // snapshot would predate the fence read.
  const epoch = await readPaidCapacityEpoch(args.db, args.companyId);
  const subscription = await args.stripe.subscriptions.retrieve(
    args.stripeSubscriptionId,
  );

  const included = PLAN_LIMITS[args.plan].numbers;

  if (subscription.schedule) {
    // #18: the schedule owns the items — never write quantities. But DO keep
    // the capacity column mirroring what's actually billed right now (a
    // pending downgrade otherwise leaves it stale for the whole period). A
    // refused raise is fine — the next run re-mirrors.
    const scheduleBilled = allExtraNumberPrices(args.env)
      .map((candidate) => findExtraNumberItem(subscription, candidate))
      .find((item) => item !== undefined)?.quantity;
    await syncPaidExtraCapacity(
      args.db,
      args.companyId,
      scheduleBilled ?? 0,
      epoch,
    );
    return null;
  }

  const count = await countNonReleasedNumbers(args.db, args.companyId);
  const desired = desiredExtraQuantity(count, args.plan);
  const day = args.now.toISOString().slice(0, 10);
  const key = (item: Stripe.SubscriptionItem, quantity: number) =>
    idempotencyKey(
      args.companyId,
      "extra_number_converge",
      item.id,
      String(quantity),
      day,
    );

  // A wrong-plan-price item (starter item after an upgrade, or vice versa):
  // migrate it to the current plan's price so it stays visible to the formula.
  // min() keeps this DOWN-ONLY in money terms — never bills more units than
  // the item already carried, never more than the formula supports.
  const stale = allExtraNumberPrices(args.env)
    .filter((candidate) => candidate !== price)
    .map((candidate) => findExtraNumberItem(subscription, candidate))
    .find((item) => item !== undefined);
  if (stale) {
    // #110: the lower DECISION serializes against slot admits under the
    // company lock — the claim re-counts and its desired is authoritative.
    const claim = await claimExtraLower(args.db, args.companyId, included);
    const quantity = Math.min(stale.quantity ?? 0, claim.desired);
    if (quantity === 0) {
      await args.stripe.subscriptionItems.del(
        stale.id,
        { proration_behavior: "create_prorations" },
        { idempotencyKey: key(stale, 0) },
      );
    } else {
      await args.stripe.subscriptionItems.update(
        stale.id,
        { price, quantity, proration_behavior: "create_prorations" },
        { idempotencyKey: key(stale, quantity) },
      );
    }
    // Capacity mirrors the FINAL billed quantity. Raise-fenced with the
    // CLAIM's epoch (the claim bumped it; nothing else may have since).
    await syncPaidExtraCapacity(args.db, args.companyId, quantity, claim.epoch);
    return { kind: "migrated", quantity };
  }

  const item = findExtraNumberItem(subscription, price);
  const billed = item?.quantity ?? 0;
  if (billed === desired) {
    // Converged — self-heal the capacity column to the billed truth (this is
    // also the #110 backfill for companies that predate the column). The raise
    // is fenced with the pre-snapshot epoch.
    await syncPaidExtraCapacity(args.db, args.companyId, billed, epoch);
    return { kind: "noop", quantity: desired };
  }

  if (billed < desired) {
    // More numbers than paid capacity — a human decides (see docblock).
    // Capacity stays at what's actually billed (fail-closed).
    await syncPaidExtraCapacity(args.db, args.companyId, billed, epoch);
    return { kind: "over_included_unbilled", billed, desired };
  }

  // billed > desired → credit the difference down (item is non-null: billed > 0).
  // #110: claim the lower under the company lock FIRST — a port/enable admitted
  // between our count above and this write is seen by the claim's re-count, and
  // an admit queued behind the lock sees the shrunk capacity. The claim's
  // desired is authoritative; if it says nothing to credit anymore, noop.
  const claim = await claimExtraLower(args.db, args.companyId, included);
  if (claim.desired >= billed) {
    return { kind: "noop", quantity: billed };
  }
  if (claim.desired === 0) {
    await args.stripe.subscriptionItems.del(
      item!.id,
      { proration_behavior: "create_prorations" },
      { idempotencyKey: key(item!, 0) },
    );
  } else {
    await args.stripe.subscriptionItems.update(
      item!.id,
      { quantity: claim.desired, proration_behavior: "create_prorations" },
      { idempotencyKey: key(item!, claim.desired) },
    );
  }
  return { kind: "lowered", quantity: claim.desired };
}

/**
 * #110: the raise-fence epoch. Read BEFORE forming any billed conclusion that
 * could RAISE the capacity column; passed to {@link syncPaidExtraCapacity} so
 * a claim in between refuses the raise.
 */
export async function readPaidCapacityEpoch(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { data, error } = await db
    .from("companies")
    .select("paid_capacity_epoch")
    .eq("id", companyId)
    .limit(1);
  if (error) {
    throw new Error(`paid_capacity_epoch read failed: ${error.message}`);
  }
  const row = (data ?? [])[0] as { paid_capacity_epoch?: number } | undefined;
  if (typeof row?.paid_capacity_epoch !== "number") {
    throw new Error("paid_capacity_epoch read returned no row");
  }
  return row.paid_capacity_epoch;
}

/**
 * #110: the serialized lower decision — claim_extra_lower locks the company
 * row, re-counts non-released numbers, shrinks `paid_extra_numbers` to the
 * formula when it exceeds it, and BUMPS the raise-fence epoch (returned for
 * follow-up syncs). The claim's desired quantity is authoritative.
 */
async function claimExtraLower(
  db: SupabaseClient,
  companyId: string,
  included: number,
): Promise<{ allowed: boolean; desired: number; count: number; epoch: number }> {
  const { data, error } = await db.rpc("claim_extra_lower", {
    p_company_id: companyId,
    p_included: included,
  });
  if (error) throw new Error(`claim_extra_lower failed: ${error.message}`);
  const row = data as {
    allowed?: boolean;
    desired?: number;
    count?: number;
    epoch?: number;
  };
  if (
    typeof row?.allowed !== "boolean" ||
    typeof row?.desired !== "number" ||
    typeof row?.count !== "number" ||
    typeof row?.epoch !== "number"
  ) {
    throw new Error("claim_extra_lower returned an unexpected shape");
  }
  return {
    allowed: row.allowed,
    desired: row.desired,
    count: row.count,
    epoch: row.epoch,
  };
}

/**
 * #110: mirror the live billed extra quantity into companies.paid_extra_numbers
 * (under the company lock). LOWERS always apply; a RAISE must carry the epoch
 * read before the billed conclusion was formed — `applied: false` means a claim
 * intervened and the caller's conclusion is stale (fail closed; never throw,
 * the next converge run re-mirrors).
 */
export async function syncPaidExtraCapacity(
  db: SupabaseClient,
  companyId: string,
  billed: number,
  expectedEpoch: number,
): Promise<{ applied: boolean }> {
  const { data, error } = await db.rpc("sync_paid_extra_capacity", {
    p_company_id: companyId,
    p_billed: billed,
    p_expected_epoch: expectedEpoch,
  });
  if (error) {
    throw new Error(`sync_paid_extra_capacity failed: ${error.message}`);
  }
  const row = data as { applied?: boolean };
  if (typeof row?.applied !== "boolean") {
    throw new Error("sync_paid_extra_capacity returned an unexpected shape");
  }
  return { applied: row.applied };
}
