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

/**
 * SPEC §2 plan limits, enforced server-side (routes/team.ts counts members +
 * invites and compares). Both self-serve plans have a hard seat cap (#83:
 * Starter 3, Pro 15). "Unlimited" seats are only sold on the Enterprise tier,
 * which is contact-sales (not a billable plan_id, no self-serve checkout), so
 * it never appears here — a company in the billing system is always starter or
 * pro with a finite cap.
 */
export const PLAN_LIMITS: Record<
  PlanId,
  { seats: number; numbers: number }
> = {
  starter: { seats: 3, numbers: 1 },
  pro: { seats: 15, numbers: 2 },
};

/**
 * #74 lifetime churn cap on manual number provisions (POST /v1/numbers/provision).
 * A released number frees its plan slot, so release -> re-provision could cycle
 * without limit — each cycle buys a fresh Telnyx number (a real cost + carrier
 * reputation churn). 20 lifetime manual provisions is far above any legitimate
 * need (a Pro's 2nd number plus the odd number change), while bounding worst-case
 * exposure to ~$20/company; support can reset the counter. The checkout
 * first-number buy does not go through this endpoint and is never counted.
 */
export const NUMBER_PROVISION_CHURN_CAP = 20;

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
 * D36 (#128): call-forwarding minutes INCLUDED per period — a fair-use
 * allowance, no longer the hard ceiling. A "minute" is a minute of the
 * forwarded (dialed) leg — the phone-bill meaning — summed by
 * api_period_forward_seconds; the both-legs internal sum
 * (api_period_voice_seconds) is cost analysis only. Past the allowance,
 * extra minutes bill at {@link VOICE_OVERAGE_CENTS_PER_MINUTE} through the
 * voice Billing Meter (tier 1 of the metered price at $0 IS this allowance,
 * exactly like segments). Forwarding pauses (USER_BUSY + missed-call text)
 * only at allowance × companies.overage_cap_multiplier — the same
 * owner-controlled spending cap that bounds text overage — enforced in
 * voice-webhook.ts, with 80%/100% owner alerts against the allowance.
 *
 * ECONOMICS (founder call, D36): both legs of a forwarded call cost
 * ~1.2¢ per forwarded minute (costs.ts) while overage sells at 1¢, so the
 * marginal overage minute runs ~0.2¢ under cost and the allowance itself is
 * subsidized by the flat $8 module — bounded by the spending cap (default 3×,
 * hard max 10×) and watched by the #85 cost-vs-revenue projection, which
 * warns before any tenant trends underwater. These are the fair-use figures
 * published at /legal/fair-use (the ONLY public home per D34).
 */
export const PLAN_VOICE_MINUTES: Record<PlanId, number> = {
  starter: 2500,
  pro: 6000,
};

/**
 * D36 (#128): overage price per extra forwarded minute, in cents — flat
 * across plans, rated to the second by the Stripe metered price (1¢ per 60
 * reported seconds). Mirrored by the graduated tiers in
 * scripts/stripe-setup.ts; used app-side only for display/projection, never
 * for invoicing (Stripe rates the meter).
 */
export const VOICE_OVERAGE_CENTS_PER_MINUTE = 1;

/**
 * D36 review fix: a GRANDFATHERED voice module (seeded free at #12, no Stripe
 * items) has no overage billing to absorb usage past its allowance, so it
 * keeps the pre-D36 deal exactly — forwarding pauses at the legacy 300
 * minutes, the boundary its economics were priced at. Paid voice modules
 * pause at PLAN_VOICE_MINUTES × overage_cap_multiplier instead.
 */
export const GRANDFATHERED_VOICE_MINUTES = 300;

// #97/#103: PLAN_MMS_INCLUDED (the $5 Picture-messages module's cap) is gone —
// picture messages are free and meter as 3 segments each through the normal
// usage pipeline, so the segment quota + overage billing bound them like text.

/**
 * #121 (supersedes D30's budgets): storage is FREE — no per-plan pools, no
 * caps, nothing pauses. The only storage backstop left is ALERTING: when a
 * company's total stored bytes (attachments + MMS media) crosses one of
 * these absolute tiers, the usage-alerts cron emails the customer AND ops
 * (OPS_ALERT_EMAIL) once per tier per period, and a human takes it from
 * there under the fair-use policy. Tiers escalate so a runaway tenant keeps
 * re-alerting as it doubles.
 */
export const STORAGE_ABUSE_TIERS_GB = [25, 50, 100, 200, 400] as const;


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
 * statuses outside the enum can never legitimately occur here (Loonext has no
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
