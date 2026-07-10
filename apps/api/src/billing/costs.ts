/**
 * #85 (child 1 / #90) — the cost + revenue model foundation.
 *
 * Everything downstream in the dynamic-limits epic (cost-so-far, end-of-period
 * extrapolation, the "have they cost us more than they pay" warning) needs two
 * numbers that did not exist anywhere as machine-readable data: (a) what a unit
 * of usage COSTS us, and (b) what a company PAYS us. This module encodes both,
 * sourced from the audited provider figures, plus pure helpers to assemble a
 * company's monthly revenue. It is purely additive — no behavior, no UI, no
 * contract change — so it can ship with zero regression.
 *
 * COST BASIS: docs/PRICING-AUDIT.md §4 "Factual provider cost basis (2026-07-04)"
 * and SPEC.md §2 / the cost comments already beside the caps in plans.ts and
 * attachments/egress.ts. Where a source gives a range, we encode the HIGH end:
 * this table exists to answer "are we losing money on this tenant?", and a
 * never-lose-money model must not UNDER-count cost. Figures are in CENTS and may
 * be fractional (sub-cent per segment); callers round only at the end.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { enabledModules } from "./company-modules";
import { MODULE_CATALOG, type PlanModule } from "./modules";
import type { PlanId } from "./plans";

/**
 * Per-unit VARIABLE cost, in cents. These scale with usage and are what the
 * period-sum RPCs (api_period_segments, api_period_inbound_segments,
 * api_period_voice_seconds, api_period_forwarded_calls, api_storage_usage,
 * api_period_egress_bytes) get multiplied by to reconstruct cost-so-far.
 */
export const UNIT_COST_CENTS = {
  /** Outbound US SMS segment: $0.004 base + $0.003–0.0045 carrier ⇒ ~$0.007–0.0085.
   *  High end (PRICING-AUDIT §4). NB: unrelated to the 3¢/2.5¢ overage PRICE.
   *  #103: outbound MMS (~$0.025 true cost: Telnyx $0.015 + up to $0.01 carrier)
   *  is covered THROUGH this rate — each MMS meters as 3 segments into
   *  usage_events, and 3 × 0.85¢ = 2.55¢ ≥ its true cost, so no separate MMS
   *  term exists (it would double-count). */
  outboundSegment: 0.85,
  /** Inbound US SMS segment: $0.004 base + $0.003 T-Mobile receive surcharge on
   *  registered traffic (SPEC §2 "COGS ~0.7¢/segment"; PRICING-AUDIT §4).
   *  Inbound MMS receive ($0.005) rides within this conservatism; its stored
   *  media draws storage + egress cost, counted via those units. */
  inboundSegment: 0.7,
  /** Forwarded voice minute: ~$0.01–0.012 for both legs; high end (plans.ts:67,
   *  PRICING-AUDIT §4). */
  voiceMinute: 1.2,
  /** Per-forwarded-call transfer/dial fee: ~$0.10 on every forwarded call — one
   *  dial command per call (PRICING-AUDIT §4; voice-webhook.ts). Scales with call
   *  COUNT, not minutes, so the 300-min voice cap can't bound it — priced from
   *  api_period_forwarded_calls, not the minute sum (#98). */
  voiceTransfer: 10,
  /** Stored file/media, per GB per month: Supabase $0.021/GB/mo (PRICING-AUDIT §4). */
  storageGbMonth: 2.1,
  /** Signed-URL egress, per GB: Supabase $0.09/GB (egress.ts:41, PRICING-AUDIT §4). */
  egressGb: 9,
} as const;

/**
 * Per-company FIXED monthly cost, in cents — incurred regardless of usage, but
 * still a per-tenant cost the revenue must cover. INCLUDED in a tenant's cost
 * baseline (unlike the shared platform cost below).
 */
export const FIXED_MONTHLY_COST_CENTS = {
  /** Number rental $1/mo + $0.10/mo SMS capability ⇒ $1.10 per number (PRICING-AUDIT §4). */
  perNumber: 110,
  /** US 10DLC campaign $10/mo (as low as $1.50 low-volume; high end kept). One
   *  campaign per US-registered company. Excluded for a Canada-only company. */
  us10dlcCampaign: 1000,
} as const;

/**
 * Shared PLATFORM cost, in cents/month (Supabase Pro $25 + misc ≈ $30, SPEC
 * §1132-1137). DELIBERATELY EXCLUDED from per-tenant cost extrapolation: it is
 * fixed across ALL tenants and does not scale per company, so loading it onto a
 * single tenant's cost-vs-revenue comparison would mislabel every low-usage
 * tenant as unprofitable when tenant count is low. Kept here as a named constant
 * so a future platform-amortized view can reference it explicitly rather than
 * re-deriving it. The dynamic warning (child 2) compares a tenant's VARIABLE +
 * per-tenant-FIXED cost against that tenant's revenue only.
 */
export const PLATFORM_MONTHLY_COST_CENTS = 3000;

/**
 * What Stripe takes off a monthly charge: 2.9% + $0.30 card processing, plus the
 * Stripe Billing recurring-invoice fee of 0.5% (0.7% on Billing Scale; the lower
 * standard rate is kept). Revenue used in the loss comparison should be NET of
 * this — see {@link stripeNetCents}.
 */
export const STRIPE_FEES = {
  percent: 0.029,
  billingPercent: 0.005,
  fixedCents: 30,
} as const;

/**
 * Server-side plan monthly revenue in cents (SPEC §2: Starter $29 / Pro $79).
 * The dollar prices otherwise live only in the Stripe price ids (plans.ts) and
 * the web mirror (types.ts) — this is the server's machine-readable source for
 * the revenue side of the comparison. The one-time $29 US registration fee is
 * intentionally NOT counted here: it is charged once ever and offsets the
 * one-time 10DLC brand ($4.50) + campaign vetting ($15) registration cost, not
 * any recurring monthly cost.
 */
export const PLAN_MONTHLY_REVENUE_CENTS: Record<PlanId, number> = {
  starter: 2900,
  pro: 7900,
};

/** Gross monthly revenue AFTER Stripe's cut, in cents (never below zero). */
export function stripeNetCents(grossCents: number): number {
  const net =
    grossCents * (1 - STRIPE_FEES.percent - STRIPE_FEES.billingPercent) -
    STRIPE_FEES.fixedCents;
  return Math.max(0, net);
}

/**
 * A company's GROSS monthly recurring revenue in cents = plan price + the price
 * of every enabled add-on module (MODULE_CATALOG.monthlyCents). Pure, so the
 * extrapolation and any test decide identically from a (plan, modules) pair.
 */
export function companyRevenueCents(
  plan: PlanId,
  modules: readonly PlanModule[],
): number {
  return modules.reduce(
    (sum, module) => sum + MODULE_CATALOG[module].monthlyCents,
    PLAN_MONTHLY_REVENUE_CENTS[plan],
  );
}

/**
 * A company's GROSS monthly recurring revenue in cents, reading its enabled
 * modules from `company_modules`. The plan is passed in (the caller already has
 * the `companies` row) to avoid a redundant read; combine with {@link
 * stripeNetCents} for the loss comparison.
 */
export async function companyMonthlyRevenueCents(
  db: SupabaseClient,
  companyId: string,
  plan: PlanId,
): Promise<number> {
  const modules = await enabledModules(db, companyId);
  return companyRevenueCents(plan, modules);
}
