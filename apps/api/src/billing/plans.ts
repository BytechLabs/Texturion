import type { Env } from "../env";

/** `plan_id` enum values (SPEC §6). */
export const PLAN_IDS = ["starter", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** `subscription_status` enum values (SPEC §6). */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "active",
  "past_due",
  "unpaid",
  "canceled",
] as const;
export type LocalSubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** SPEC §2 plan limits, enforced server-side. */
export const PLAN_LIMITS: Record<PlanId, { seats: number; numbers: number }> = {
  starter: { seats: 3, numbers: 1 },
  pro: { seats: 10, numbers: 2 },
};

/** Included outbound segments per month (SPEC §2). */
export const PLAN_INCLUDED_SEGMENTS: Record<PlanId, number> = {
  starter: 500,
  pro: 2500,
};

/** Overage price per extra outbound segment, in cents (SPEC §2). */
export const PLAN_OVERAGE_CENTS_PER_SEGMENT: Record<PlanId, number> = {
  starter: 3,
  pro: 2.5,
};

/**
 * D30: per-company budget for the generic `attachments` bucket (note-borne
 * files), enforced at POST /v1/attachments as a company-wide sum(size_bytes)
 * over LIVE rows. Starter 5 GB, Pro 25 GB. MMS media is deliberately NOT
 * gated on this budget (inbound customer content is never blocked; outbound
 * MMS is already metered/capped) — it only counts toward the usage display.
 */
export const STORAGE_BUDGET_BYTES: Record<PlanId, number> = {
  starter: 5 * 1024 * 1024 * 1024,
  pro: 25 * 1024 * 1024 * 1024,
};

/** Human figure for the D30 budget copy ("5 GB", "25 GB"). */
export function storageBudgetLabel(plan: PlanId): string {
  return `${STORAGE_BUDGET_BYTES[plan] / (1024 * 1024 * 1024)} GB`;
}

export interface PlanPrices {
  licensed: string;
  metered: string;
}

/** The env-configured price pair for a plan (SPEC §9 catalog). */
export function planPrices(env: Env, plan: PlanId): PlanPrices {
  return plan === "starter"
    ? {
        licensed: env.STRIPE_STARTER_PRICE_ID,
        metered: env.STRIPE_STARTER_OVERAGE_PRICE_ID,
      }
    : {
        licensed: env.STRIPE_PRO_PRICE_ID,
        metered: env.STRIPE_PRO_OVERAGE_PRICE_ID,
      };
}

/** Which plan a licensed Stripe price id belongs to; null for foreign prices. */
export function planForLicensedPrice(env: Env, priceId: string): PlanId | null {
  if (priceId === env.STRIPE_STARTER_PRICE_ID) return "starter";
  if (priceId === env.STRIPE_PRO_PRICE_ID) return "pro";
  return null;
}

/**
 * Map a Stripe subscription status onto the SPEC §6 enum. The two Stripe
 * statuses outside the enum can never legitimately occur here (JobText has no
 * trials and never pauses collection), but a webhook must not crash on them:
 * `trialing` degrades to `active` (it is a collectible, live subscription) and
 * `paused` returns null — the caller skips the mirror and leaves the last
 * known status in place.
 */
export function mirrorSubscriptionStatus(
  stripeStatus: string,
): LocalSubscriptionStatus | null {
  if (
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(stripeStatus)
  ) {
    return stripeStatus as LocalSubscriptionStatus;
  }
  if (stripeStatus === "trialing") return "active";
  return null;
}

/**
 * SPEC §4.1 step 4 / §9 checkout gate: one subscription per company, ever
 * concurrent — these statuses mean a live (or collectible) subscription
 * already exists and checkout must 409.
 */
export function hasLiveSubscription(status: LocalSubscriptionStatus): boolean {
  return status === "active" || status === "past_due" || status === "unpaid";
}
