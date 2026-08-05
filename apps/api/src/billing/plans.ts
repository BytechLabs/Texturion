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

/**
 * #343 - the daily inbound-notification ceilings, per plan, per channel.
 *
 * These replace a single `v_notify_limit constant int := 200` buried in a
 * migration: identical for a sole proprietor and a ten-tech crew, unraisable
 * for a customer who legitimately needs more, unlowerable during an abuse
 * event, and unchangeable without a migration and a deploy.
 *
 * WHY EMAIL AND PUSH ARE SEPARATE. The 200 was sized to bound a Resend bill,
 * and since then D45 retired missed-call emails as noise and the mix moved
 * heavily to push. Push is free at both ends - Web Push and FCM charge
 * nothing, and the only marginal cost is a few Worker CPU-milliseconds - so a
 * limit sized for email was throttling notifications that cost essentially
 * nothing. One number could not be right for both.
 *
 * HOW THESE WERE PICKED, monthly on both sides. A daily cost compared against
 * monthly revenue reads thirty times better than it is, which is exactly the
 * error that made an earlier draft of this look affordable:
 *
 *   cost/claim = UNIT_COST_CENTS.notificationEmail
 *                  x min(seats, MAX_EMAIL_RECIPIENTS_PER_CLAIM)
 *              = 0.09c x 3 = 0.27c
 *
 *   starter 100/day -> $8.10/mo against $27.71 net  = 29%
 *   pro     250/day -> $20.25/mo against $76.01 net = 27%
 *
 * at the ABSOLUTE ceiling, which a real trades business never approaches - a
 * cap is a runaway guard, not a budget. Both plans land near 28% of net in the
 * worst case, and they only line up because the fan-out is bounded: without
 * that bound a Pro claim costs five times a Starter one, so Pro would need a
 * LOWER ceiling than Starter to stay solvent. Paying more for fewer
 * notifications is not a product worth shipping.
 *
 * Push is capped purely as a runaway guard - a loop, a spam flood, a webhook
 * storm - at a level no real workspace reaches.
 *
 * Overridable per company via `companies.notify_email_limit` /
 * `notify_push_limit`, which are OPS-ONLY: they are deliberately not on
 * PATCH /v1/company, because a ceiling the customer can raise is not a
 * ceiling (#12).
 */
export const PLAN_NOTIFY_LIMITS: Record<
  PlanId,
  { email: number; push: number }
> = {
  starter: { email: 100, push: 2000 },
  pro: { email: 250, push: 5000 },
};

/**
 * #343: how many people one inbound notification emails, at most.
 *
 * The claim still fans out to every viewer; this bounds only the EMAIL arm,
 * and push reaches everyone as before. It exists so the per-claim cost does
 * not scale with crew size (see the derivation above), and it stands on its
 * own terms too: an inbound text does not need fifteen inboxes to hear about
 * it, and D45 already retired a whole class of email as noise.
 */
export const MAX_EMAIL_RECIPIENTS_PER_CLAIM = 3;

/**
 * #400/D107 — what a prepaid year costs, in cents. Ten months for twelve.
 *
 * $290 against 12 x $29 = $348, an effective $24.17/mo. $790 against 12 x $79 =
 * $948, an effective $65.83/mo. The discount is real and delivered through the
 * PRICE — an earlier design delivered it through a customer-balance credit,
 * which funds ten invoices rather than twelve and was reverted for it.
 */
export const PLAN_PREPAY_YEAR_CENTS: Record<PlanId, number> = {
  starter: 29_000,
  pro: 79_000,
};

/** How many monthly invoices a prepaid year covers. Matches the coupon. */
export const PREPAY_MONTHS = 12;

/**
 * The one-time price id for a prepaid year, or null when unprovisioned.
 *
 * Null is the feature flag: with no price the offer exists nowhere, because a
 * surface that sells something we cannot deliver is worse than no surface.
 */
export function prepayYearPrice(env: Env, plan: PlanId): string | null {
  const id =
    plan === "starter"
      ? env.STRIPE_STARTER_YEAR_PRICE_ID
      : env.STRIPE_PRO_YEAR_PRICE_ID;
  return id && id.length > 0 ? id : null;
}

/** Overage price per extra outbound segment, in cents (SPEC 2). */
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

// #134/D42: GRANDFATHERED_VOICE_MINUTES retired — calling is included on
// every plan and every workspace gets the plan allowance.

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

/**
 * #449 — absolute inbound-segment tiers, the one cost centre with no ceiling.
 *
 * Inbound is free to the customer and costs us 1.0c a segment (#445 measured
 * the four-carrier composition; it was 0.7c before), and it CANNOT
 * be capped: refusing to receive a customer's texts is refusing the product.
 * Worse, the cost is already incurred before any of our code runs — Telnyx has
 * received and billed the segment by the time the webhook fires, so no throttle
 * of ours can prevent it. Only suspending the number can, which is an abuse
 * call a human makes.
 *
 * So this is not a cap and cannot become one. It is the storage-abuse shape
 * (#121): absolute tiers, customer AND ops told, nothing blocked. It exists so
 * the one unbounded cost in the product stops being invisible.
 *
 * The tiers are chosen in OUR money rather than round segment counts, because
 * the point is the spend: at 1.0c they are $25, $50, $100, $250 and $500. The
 * first tier already exceeds half a Starter tenant's net monthly revenue
 * ($27.71, PRICING-AUDIT.md section 10), which is the right place for the
 * first word about it.
 */
export const INBOUND_ABUSE_TIERS_SEGMENTS = [
  2_500, 5_000, 10_000, 25_000, 50_000,
] as const;


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
 * #277 — the licensed price a PAUSED subscription carries, or null when the
 * pause is not provisioned in this environment.
 *
 * Null is the feature flag, the same way {@link prepayYearPrice} is: with no
 * price the offer exists nowhere, and it fails CLOSED — no price means no
 * pause, never a free one. Empty string is normalised to null because a
 * Cloudflare variable that was created and then blanked reads as `""`, and an
 * empty price id would sail through a bare truthiness check and then 400 at
 * Stripe, halfway through a swap.
 *
 * The deliberate consequence is that {@link planForLicensedPrice} returns null
 * for this price. `syncSubscription` writes `...(plan ? { plan } : {})`, so
 * `companies.plan` is LEFT ALONE while paused and keeps holding the plan the
 * workspace resumes onto. That is load-bearing, not incidental: a third
 * `plan_id` value would give the quota CASE in
 * 20260701001100_messaging_functions.sql no arm, making the overage spending
 * cap NULL and therefore permanently open.
 */
export function pauseLicensedPrice(env: Env): string | null {
  const id = env.STRIPE_PAUSE_PRICE_ID;
  return id && id.length > 0 ? id : null;
}

/**
 * True when this Stripe price id is the pause price.
 *
 * False whenever the pause is unprovisioned, which is the honest reading: with
 * no configured price we cannot tell a pause price from any other foreign
 * price, and claiming otherwise would be guessing about somebody's money.
 * Callers that must not un-pause a workspace on a guess (the subscription
 * mirror) branch on "recognised a PLAN price" instead — see syncSubscription.
 */
export function isPauseLicensedPrice(env: Env, priceId: string): boolean {
  const pause = pauseLicensedPrice(env);
  return pause !== null && priceId === pause;
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

/**
 * #448 — the dial-count lines, the ceiling the SECONDS-denominated spending
 * cap structurally cannot express.
 *
 * Every dial command costs ~10c whatever happens next
 * (UNIT_COST_CENTS.voiceTransfer), so a run of very short calls accrues almost
 * nothing against the minute cap and real money against us. Both lines are
 * derived from the ceiling the customer already chose rather than invented:
 *
 *   alertAt — dial fees reach what this tenant's minutes could cost us AT the
 *             cap (capMinutes x 1.2c). Starter at 1x: $30, so ~300 dials. The
 *             founder hears while it is happening, per the alert-before-the-cap
 *             rule the AI features already follow.
 *   stopAt  — five times that. Fifty outbound calls a day every day on a
 *             starter plan is not a busy week, it is a loop.
 *
 * Deliberately generous, because the failure mode of a tight ceiling is
 * refusing to dial a real customer, which is worse than the fee. Where the
 * ECONOMIC ceiling belongs is #446's question; this is only the runaway
 * backstop, sized so it can catch nothing else.
 *
 * The cents are inlined rather than imported from costs.ts to keep this module
 * dependency-free (it is imported by both billing and messaging); the drift
 * guard is a test asserting they still match UNIT_COST_CENTS.
 */
export const DIAL_STOP_MULTIPLE = 5;

/** Hard ceiling on the customer-set cap multiplier (mirrors voice-webhook). */
const MAX_DIAL_CAP_MULTIPLIER = 10;

export function dialCeilings(
  plan: PlanId,
  overageCapMultiplier: number | string | null,
): { alertAt: number; stopAt: number } {
  const multiplier = Number(overageCapMultiplier);
  const capMultiplier =
    Number.isFinite(multiplier) && multiplier > 0
      ? Math.min(multiplier, MAX_DIAL_CAP_MULTIPLIER)
      : MAX_DIAL_CAP_MULTIPLIER;
  const capMinutes = PLAN_VOICE_MINUTES[plan] * capMultiplier;
  // What those minutes cost US at the cap (1.2c/min), converted to dials at
  // 10c each — "dial fees may not exceed what the minute cap already allows".
  const alertAt = Math.max(1, Math.floor((capMinutes * 1.2) / 10));
  return { alertAt, stopAt: alertAt * DIAL_STOP_MULTIPLE };
}
