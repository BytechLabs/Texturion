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
 * #12 call-forwarding minutes included per period, before the hard cap. A
 * forwarded call runs two billable Telnyx legs (~$0.012/min combined), and
 * there is no voice-overage billing yet, so every included minute is a cost we
 * eat — this allowance is therefore ALSO our max per-company voice exposure per
 * period (allowance × cost). Sized to mirror the segment quota for an easy
 * mental model; the 80% owner alert + the hard cap (voice-webhook.ts) are the
 * real protection, and these numbers are placeholders to retune when the opt-in
 * voice module adds metered overage. Kept as a constant so tuning is one edit.
 */
export const PLAN_VOICE_MINUTES: Record<PlanId, number> = {
  starter: 500,
  pro: 2500,
};

/**
 * D30: per-company budget for the generic `attachments` bucket (note-borne
 * files), enforced at POST /v1/attachments as an atomic company-wide
 * sum(size_bytes) over LIVE rows (claim_attachment_storage). Starter 5 GB,
 * Pro 25 GB. This budget is ATTACHMENTS-ONLY — inbound MMS media lives in its
 * own bucket with its own #12 cost cap (MMS_STORAGE_BUDGET_BYTES); the two
 * never share a pool, so heavy file use never drops a customer's picture and
 * vice-versa.
 */
export const STORAGE_BUDGET_BYTES: Record<PlanId, number> = {
  starter: 5 * 1024 * 1024 * 1024,
  pro: 25 * 1024 * 1024 * 1024,
};

/**
 * #12 cap-and-drop budget for the `mms-media` bucket (inbound picture-message
 * media, which we download + store on our dollar). Symmetrical with the
 * attachment budget — Starter 5 GB, Pro 25 GB — but a SEPARATE pool: once a
 * company's stored MMS media reaches this, new inbound media is dropped (the
 * text still lands) so an image flood can never grow our storage bill past
 * what the plan pays for. The owner is warned at 80% / 100% by the storage
 * arm of the usage-alerts cron before/when drops begin.
 */
export const MMS_STORAGE_BUDGET_BYTES: Record<PlanId, number> = {
  starter: 5 * 1024 * 1024 * 1024,
  pro: 25 * 1024 * 1024 * 1024,
};

/**
 * #12 extra_storage module: the additional room the "Extra storage" add-on
 * grants to EACH pool (attachments + MMS media) when enabled. Placeholder,
 * tweakable — kept here as the one source of truth.
 */
export const EXTRA_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;

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
