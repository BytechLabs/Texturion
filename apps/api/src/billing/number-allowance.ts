/**
 * #523 — what a workspace may hold, what it actually holds, and what happens to
 * the difference.
 *
 * THE DEFECT THIS CLOSES. `POST /v1/billing/checkout` counts neither numbers nor
 * seats (`change-plan` counts both), and the completion handler un-suspended
 * every held number with one statement that carried no plan term. During the
 * 30-day grace window `change-plan` refuses a cancelled subscription outright,
 * so checkout is the only route back — and the #277 win-back puts a "Come back
 * on Starter" button on exactly that path. A Pro workspace holding two numbers
 * pressed it and came back holding two, on a plan that includes one.
 *
 * Nothing then corrected it. `convergeExtraNumberQuantity` is down-only by
 * design (#105), so the surplus was never billed — it produced an
 * `over_included_unbilled` Sentry warning every day at 15:00 and we paid the
 * $1.10/mo Telnyx rent (`FIXED_MONTHLY_COST_CENTS.perNumber`) on it forever.
 * `runGraceJob` never reclaims it either: both of its scans require
 * `subscription_status = 'canceled'`, and this workspace is live and paying.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * Coming back is never refused. That is #277's decision and this module does
 * not re-open it: nothing here can fail a checkout, because everything here runs
 * after the money has moved. What changes is what happens NEXT — the plan they
 * bought is respected, and they are told.
 *
 *   bring back   what the plan includes plus the extras actually billed,
 *                oldest first (the number on the van, not the one bought last
 *                month)
 *   hold         the rest, `suspended` — inbound still lands, history intact,
 *                nothing released to the carrier
 *   say so       an email and a push at the moment it happens, and a billing
 *                surface that names each held number and both routes back
 *
 * ── WHY A HELD NUMBER IS NOT A FREE ONE ───────────────────────────────────
 *
 * It still costs us rent, so "hold it and say nothing" would just be the old
 * defect with a different status. The two routes back both END the hold rather
 * than prolong it: move to Pro (the allowance rises and the claim reinstates
 * what fits), or buy the number as a paid extra (the quantity rises, the charge
 * lands now, and the same claim brings it back). Both are the customer's
 * decision at a moment they chose, which is the difference between a charge and
 * a surprise.
 *
 * ── WHY THE DECISION LIVES IN ONE RPC ─────────────────────────────────────
 *
 * The allowance and the un-suspend are one decision. Splitting them across a
 * read and a write leaves a window in which a port claim, a text-enablement
 * claim or a manual provision — each of which admits against
 * `included + paid_extra_numbers` under the company-row lock — lands in
 * between, and the slot is handed out twice. `claim_number_allowance` takes the
 * same lock and does all of it in one statement; the migration argues it in
 * full.
 */
import { STARTER_MAX_TOTAL_NUMBERS } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { extraNumberPrice, findExtraNumberItem } from "./extra-numbers";
import { PLAN_LIMITS, type PlanId } from "./plans";
import type { Stripe } from "./stripe";
import type { Env } from "../env";

/** A number this workspace holds but its plan does not currently cover. */
export interface HeldNumber {
  id: string;
  number_e164: string | null;
  /** When it was suspended. Null only for a row suspended before this shipped. */
  suspended_at: string | null;
}

export interface NumberAllowanceClaim {
  /**
   * False ONLY on the all-or-nothing refusal of a named purchase (`preferId`):
   * the claim could not bring that number back, so it wrote nothing at all — no
   * capacity, no epoch bump, no restore. The caller has nothing to charge for.
   */
  applied: boolean;
  /**
   * False when the caller could not resolve the plan (an unreadable price
   * catalog, or a paused subscription whose licensed item is the pause price).
   * Everything is restored and no capacity is written — see the migration.
   */
  planKnown: boolean;
  /** Included + paid extras, or null when the plan was unreadable. */
  allowance: number | null;
  /** The paid extra capacity the claim settled on. */
  capacity: number;
  /** #110: the caller's billed figure was a raise and the epoch was stale. */
  capacityFenced: boolean;
  restored: { id: string; number_e164: string | null }[];
  held: HeldNumber[];
}

/**
 * The most PAID extras a plan will sell — Starter is hard-capped at 2 numbers
 * total (#80), Pro is unlimited. `null` means no cap.
 *
 * Derived from the two constants rather than written as "1", so a change to
 * either `STARTER_MAX_TOTAL_NUMBERS` or `PLAN_LIMITS.starter.numbers` moves this
 * with it. A literal here is the ceiling-instead-of-check shape that has cost
 * this repo several issues.
 */
export function maxSellableExtras(plan: PlanId): number | null {
  return plan === "starter"
    ? STARTER_MAX_TOTAL_NUMBERS - PLAN_LIMITS[plan].numbers
    : null;
}

/**
 * The most numbers a plan will ever let a workspace hold — included plus every
 * extra it will sell. `null` when there is no ceiling (Pro).
 */
export function maxTotalNumbers(plan: PlanId): number | null {
  const extras = maxSellableExtras(plan);
  return extras === null ? null : PLAN_LIMITS[plan].numbers + extras;
}

/**
 * Can this workspace buy capacity for ONE more held number right now?
 *
 * Distinct from `extraNumberPurchasable`, which asks whether a NEW number may be
 * bought and therefore reasons about the count. Reinstating changes no count —
 * the number already exists and we are already paying its rent — so the question
 * is only whether the plan will sell one more unit of capacity.
 */
export function canBuyMoreCapacity(plan: PlanId, paidExtras: number): boolean {
  const cap = maxSellableExtras(plan);
  return cap === null || paidExtras + 1 <= cap;
}

/** What the subscription bills in extra numbers for `plan`, right now. */
export function billedExtraQuantity(
  env: Env,
  subscription: Stripe.Subscription,
  plan: PlanId,
): number {
  const price = extraNumberPrice(env, plan);
  if (!price) return 0;
  return findExtraNumberItem(subscription, price)?.quantity ?? 0;
}

/**
 * Settle the workspace's numbers against its allowance (see the module header).
 *
 * `included` is null when the plan could not be resolved — the claim then
 * restores everything and writes no capacity, which is exactly what the
 * statement this replaced always did.
 *
 * `expectedEpoch` is the #110 raise fence and is only needed when `paidExtras`
 * is ABOVE what the company row already stores. It must have been read BEFORE
 * the Stripe conclusion it accompanies; without it a raise is refused and the
 * allowance falls back to the stored capacity (fail closed — hold one more,
 * never hand out a free number).
 *
 * `preferId` names the ONE number a purchase is for. It makes the claim
 * all-or-nothing: that number comes back first, or nothing is written and
 * `applied` is false. It is what lets the reinstate route claim BEFORE it
 * charges — see the migration, and the route's own ordering note.
 */
export async function claimNumberAllowance(
  db: SupabaseClient,
  args: {
    companyId: string;
    included: number | null;
    paidExtras: number;
    expectedEpoch?: number | null;
    preferId?: string;
  },
): Promise<NumberAllowanceClaim> {
  const { data, error } = await db.rpc("claim_number_allowance", {
    p_company_id: args.companyId,
    p_included: args.included,
    p_paid_extras: args.paidExtras,
    p_expected_epoch: args.expectedEpoch ?? null,
    p_prefer_id: args.preferId ?? null,
  });
  if (error) {
    throw new Error(`claim_number_allowance failed: ${error.message}`);
  }
  const row = data as {
    applied?: boolean;
    plan_known?: boolean;
    allowance?: number | null;
    capacity?: number;
    capacity_fenced?: boolean;
    restored?: { id: string; number_e164: string | null }[];
    held?: HeldNumber[];
  } | null;
  // `applied` is checked as strictly as `plan_known`: a deploy talking to a
  // database that predates it would otherwise look like a claim that wrote
  // everything, and the route would charge on the strength of it.
  if (
    typeof row?.plan_known !== "boolean" ||
    typeof row.applied !== "boolean" ||
    !Array.isArray(row.restored)
  ) {
    throw new Error("claim_number_allowance returned an unexpected shape");
  }
  return {
    applied: row.applied,
    planKnown: row.plan_known,
    allowance: row.allowance ?? null,
    capacity: row.capacity ?? 0,
    capacityFenced: row.capacity_fenced === true,
    restored: row.restored,
    held: Array.isArray(row.held) ? row.held : [],
  };
}

/**
 * What the owner is told when numbers come back held.
 *
 * One function so the email, the push and the billing surface cannot describe
 * the same state three different ways — the drift #392 and #464 both came down
 * to, in a product where the same sentence is rendered by a Worker, a browser
 * and two phones.
 *
 * It says what is held, that it is NOT gone, and both ways back. It never says
 * "released", because nothing was.
 */
export function heldNumbersCopy(args: {
  companyName: string;
  plan: PlanId;
  allowance: number;
  held: HeldNumber[];
}): { subject: string; text: string } {
  const numbers = args.held
    .map((row) => row.number_e164)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const list = numbers.length > 0 ? numbers.join(", ") : "one of your numbers";
  const plural = args.held.length === 1 ? "number is" : "numbers are";
  const subject =
    args.held.length === 1
      ? "One of your numbers is on hold"
      : `${args.held.length} of your numbers are on hold`;

  const routes =
    args.plan === "starter"
      ? "Move to Pro, or add it as a paid extra number — either brings it straight back:"
      : "Add it as a paid extra number and it comes straight back:";

  const text =
    `Hi,\n\n` +
    `Welcome back. ${args.companyName}'s subscription is active again and your ` +
    `service is running.\n\n` +
    `Your plan covers ${args.allowance} ${args.allowance === 1 ? "number" : "numbers"}, ` +
    `and you have more than that, so ${args.held.length === 1 ? "this" : "these"} ` +
    `${plural} on hold: ${list}\n\n` +
    `A number on hold has NOT been given up. We are still holding it for you, ` +
    `texts and calls still reach it, and nothing in its history has been ` +
    `touched — you just can't send or answer from it while it's on hold.\n\n` +
    `${routes}\n`;

  return { subject, text };
}

/**
 * #526 — the two sentences that are the only record that an owner was NOT told.
 *
 * Both live here rather than at the call site, and both are exported, because a
 * guard that types the phrase into the test is a guard that passes when the
 * alert is deleted and replaced with a differently-worded one, and one that
 * asserts nothing at all is what #526 R3 found: removing BOTH Sentry calls from
 * the notice's catch left all 51 tests in stripe.test.ts green.
 *
 * SILENCE IS THE FAILURE MODE, not noise. The handler stamps `processed_at`, so
 * the sweeper will not replay it, and if the confirm-checkout poller already ran
 * for that session the ledger key is spent. After that there is nothing left in
 * the product that would ever say the hold was applied and never announced — the
 * owner simply has a number that stops sending, and finds out when a customer
 * tells them.
 */
export function heldNoticeUnannouncedAlert(args: {
  companyId: string;
  sessionId: string;
  held: number;
}): string {
  return (
    `checkout ${args.sessionId}: company ${args.companyId} came back holding ` +
    `${args.held} number(s) and could NOT be told — the hold is applied and unannounced`
  );
}

/**
 * The other way the same silence happens, and the one that throws nothing at
 * all: `billingRecipients` returns an empty list, so there is no email to send
 * and no error to catch. The push still goes (its audience is user ids, not
 * addresses), but the channel we treat as the durable one did not run and
 * nothing recorded that.
 */
export function heldNoticeNoRecipientsAlert(args: {
  companyId: string;
  held: number;
}): string {
  return (
    `held-number notice for company ${args.companyId}: ${args.held} number(s) are on ` +
    `hold and the workspace has no billing email address — the email was not sent, ` +
    `only the push`
  );
}
