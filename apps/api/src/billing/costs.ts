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

import { amortisedMonthlyUsdCents, openPrepayment } from "./prepay";

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
  /**
   * Outbound US SMS segment. **1.15¢, raised from 0.85¢ (#445, 2026-07-28).**
   *
   * This is the one unit cost in this file measured rather than estimated.
   * Telnyx reports the real cost of every outbound message on the delivery
   * webhook (`messages.provider_cost`, #216), and production says:
   *
   *     0.91c x3   0.98c x8   1.05c x1   1.13c x11   1.135c x1
   *
   * — modal 1.13¢, mean 1.05¢ excluding one 3.27¢ outlier, over 26 segments.
   * The old 0.85¢ figure UNDER-counted by roughly a third, against this
   * module's own rule that a never-lose-money model must not under-count. 1.15¢
   * is the high end of the observed range, which is the rule applied.
   *
   * It also answers #445 ask 5: **Telnyx passes the 2026 carrier surcharges
   * through** rather than absorbing them. A $0.004 base plus the old assumed
   * $0.003 surcharge cannot produce a measured 1.13¢; the three A2P increases
   * that landed in 2026 (T-Mobile and US Cellular in January, AT&T in April)
   * are inside what Telnyx bills us.
   *
   * NB: unrelated to the 3¢/2.5¢ overage PRICE. #103: outbound MMS (~$0.025
   * true cost) is covered THROUGH this rate — each MMS meters as 3 segments, so
   * 3 × 1.15¢ = 3.45¢ ≥ its true cost and no separate MMS term exists.
   */
  outboundSegment: 1.15,
  /**
   * Inbound US SMS segment. **1.0¢, raised from 0.7¢ (#445, 2026-07-28).**
   *
   * ESTIMATED, and it cannot currently be anything else: Telnyx reports message
   * cost on the DELIVERY-status webhook, which only fires for messages we send.
   * Production holds 21 inbound messages and zero costed ones, so
   * `api_period_provider_cost` — the "ground truth" arm of the projection — is
   * outbound-only and silently omits this line entirely. The projection takes
   * the HIGHER of estimate and actual, which is what keeps that omission from
   * under-reporting; the estimate is load-bearing here, not decorative.
   *
   * Composition, naming every carrier that charges rather than one (#445 ask 2):
   *   $0.004  Telnyx base receive
   *   $0.0025 T-Mobile MO surcharge on registered traffic (19 Jan 2026)
   *   $0.0025 AT&T, which from 1 Apr 2026 applies its pass-through to
   *           mobile-ORIGINATED traffic as well as terminated — the change the
   *           old single-carrier comment could not have accounted for
   *   +       US Cellular (19 Jan 2026), small share, inside the rounding
   * ⇒ ~0.95¢, carried at 1.0¢ as the high end.
   *
   * This is the line with NO offsetting revenue (inbound is free to the
   * customer, D5; uncappable per D58) and no ceiling, so an understatement here goes straight
   * through to the profitability answer. It is also the least verifiable number
   * in the file, which is the honest state of it.
   *
   * Inbound MMS receive ($0.005) rides within this conservatism; its stored
   * media draws storage + egress cost, counted via those units.
   */
  inboundSegment: 1.0,
  /** Forwarded voice minute: ~$0.01–0.012 for BOTH legs of one forwarded
   *  minute; high end (PRICING-AUDIT §4). D36: multiplied against the
   *  forward-leg (dialed) minute sum — the same measure the 1¢/min overage
   *  bills, which therefore sells ~0.2¢/min under this cost (founder call;
   *  bounded by the spending cap, watched by the #85 projection). */
  voiceMinute: 1.2,
  /** Per-forwarded-call transfer/dial fee: ~$0.10 on every forwarded call — one
   *  dial command per call (PRICING-AUDIT §4; voice-webhook.ts). Scales with call
   *  COUNT, not minutes, so the voice SPENDING cap can't bound it — priced from
   *  api_period_forwarded_calls, not the minute sum (#98).
   *
   *  #448: it has its own count ceiling now (`companyOverDialCap`), because a
   *  cost centre the money cap structurally cannot reach is exactly the kind
   *  this product does not leave uncapped. Only legs we DIAL are counted
   *  ('forward','out_agent','out_customer'); an inbound call is never one of
   *  them — it lands as 'in_browser'/'vm_inbound'/'inbound_untagged' and the
   *  member ring legs are SIP legs we absorb — so the exposure is outbound
   *  origination, not a stranger dialling our number. */
  voiceTransfer: 10,
  /** Stored file/media, per GB per month: Supabase $0.021/GB/mo (PRICING-AUDIT §4). */
  storageGbMonth: 2.1,
  /** Signed-URL egress, per GB: Supabase $0.09/GB (egress.ts:41, PRICING-AUDIT §4). */
  egressGb: 9,
  /**
   * One notification email: Resend $0.90/1k (PRICING-AUDIT §4).
   *
   * PER RECIPIENT, not per send — and that is an ASSUMPTION rather than a
   * measurement, which is the honest state of this number.
   * `notifyInboundMessage` makes ONE Resend call carrying every recipient in a
   * `to` array, so if Resend bills per message a claim costs 0.09c flat and
   * this over-counts by the crew size. Nothing in this repo settles which it
   * is; the audit's own note ("one email/member/new thread") assumed the
   * per-recipient reading too.
   *
   * The expensive reading is the one kept, because the cost-protection
   * mandate is asymmetric: a ceiling sized against a cost that turns out
   * lower is merely conservative, while one sized against a cost that turns
   * out higher is the founder eating the difference. Confirm per-message
   * billing and this becomes a flat 0.09c, and PLAN_NOTIFY_LIMITS can rise.
   */
  notificationEmail: 0.09,
} as const;

/**
 * #380 — per-REQUEST cost of each AI cost centre, in cents.
 *
 * Keyed on `company_ai_usage.feature`, which is what the ledger counts: one row
 * per company per calendar month per feature, incremented once per request. So
 * the unit here must be a whole request, not a token — tokens are what
 * Cloudflare bills, requests are what we can attribute to a tenant.
 *
 * Every figure is the bounded WORST CASE for one request, from the caps the
 * feature code already enforces, priced at Cloudflare's published Workers AI
 * rates (2026-07-28, developers.cloudflare.com/workers-ai/platform/pricing).
 * That is the never-under-count rule applied: a typical request costs a
 * fraction of these.
 *
 * NB a stale price found while deriving this: `reply-suggestions.ts` cites
 * $0.287 per million output tokens; Cloudflare now publishes $0.384 for that
 * model. The figures below use the published rate.
 */
export const AI_UNIT_COST_CENTS = {
  /**
   * Task enrichment on `@cf/meta/llama-3.2-1b-instruct`
   * ($0.027/M in, $0.201/M out). Output is capped at 256 tokens
   * (ENRICHMENT_MAX_OUTPUT_TOKENS); input is one task's text, taken generously
   * at ~1,000 tokens. 1000x0.027/1e6 + 256x0.201/1e6 = $0.0000785 ⇒ 0.008c,
   * carried at 0.01c.
   */
  enrich: 0.01,
  /**
   * Reply drafting on `@cf/meta/llama-3.1-8b-instruct-fast`
   * ($0.045/M in, $0.384/M out) — the expensive shape, and the one that scales
   * with how much a customer LIKES the product.
   *
   * Input is genuinely bounded by the feature: 12 messages
   * (SUGGEST_REPLY_CONTEXT_MESSAGES) x 600 chars
   * (SUGGEST_REPLY_MAX_MESSAGE_CHARS) + a 500-char draft + the business
   * description ⇒ ~8,500 chars ⇒ ~2,125 tokens. Output is capped at 700
   * (SUGGEST_REPLY_MAX_OUTPUT_TOKENS).
   * 2125x0.045/1e6 + 700x0.384/1e6 = $0.000364 ⇒ 0.036c, carried at 0.04c.
   */
  suggest_reply: 0.04,
  /**
   * Voicemail transcription on `@cf/openai/whisper-large-v3-turbo`
   * ($0.0005 per audio minute). Nothing bounds recording length in-product, so
   * this takes the 5-minute case the module's own comment uses as its
   * reference: 5 x $0.0005 = $0.0025 ⇒ 0.25c.
   *
   * Deliberately far above the typical voicemail, which runs under a minute.
   * Over-counting a cost is this file's stated posture, and at the 500/month
   * cap the whole line is $1.25 either way.
   */
  voicemail_transcript: 0.25,
  /**
   * Voicemail intake (#367 depth 1) on `@cf/meta/llama-3.1-8b-instruct-fast`
   * ($0.045/M in, $0.384/M out) — the same model reply drafting uses, on a much
   * smaller input.
   *
   * Input is the stored transcript, bounded by
   * VOICEMAIL_INTAKE_MAX_TRANSCRIPT_CHARS (4,000) plus a ~400-char system
   * prompt ⇒ ~1,100 tokens at the ceiling. Output is capped at 256
   * (VOICEMAIL_INTAKE_MAX_OUTPUT_TOKENS) and is in practice four short strings.
   * 1100x0.045/1e6 + 256x0.384/1e6 = $0.000148 ⇒ 0.015c, carried at 0.02c.
   *
   * Worth stating next to D78, which priced the OTHER version of this feature:
   * a realtime receptionist costs 6.8c per MINUTE, so a two-minute call is
   * 13.6c — roughly 700x this. That gap is the whole reason depth (1) needs no
   * paid module and the realtime version necessarily does.
   */
  voicemail_intake: 0.02,
  /**
   * #507 Phase 1: crew wrap-up dictation on
   * `@cf/openai/whisper-large-v3-turbo` ($0.0005 per audio minute).
   *
   * Bounded by the feature rather than by hope: CALL_WRAPUP_MAX_SECONDS is 120,
   * so the ceiling is 2 x $0.0005 = $0.001 => 0.1c. A real wrap-up is a
   * sentence or three and runs well under twenty seconds, so this over-counts
   * by roughly six times — which is this file's stated posture.
   *
   * Cheaper per call than voicemail_transcript (0.25c) for the same model, and
   * the reason is the length gate: a voicemail is however long a stranger talks
   * for, a wrap-up is however long somebody holds a button.
   *
   * No LLM pass rides on top of this. The dictation is stored verbatim
   * (ai/call-wrapup.ts explains why a paraphrase would defeat the feature), so
   * unlike voicemail there is no second cost centre for structuring.
   */
  call_wrapup: 0.1,
} as const;

/** The `company_ai_usage.feature` keys the cost model knows how to price. */
export type AiCostFeature = keyof typeof AI_UNIT_COST_CENTS;

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
  /**
   * #400/D107 — what the PLAN part is actually worth this month, when the
   * workspace has prepaid a year and its licensed line invoices at $0.
   *
   * Without this the projection counts $29 a month that is not being collected,
   * muting the one alert that catches a tenant costing more than it pays — for
   * exactly the cohort that has already paid everything it is ever going to
   * pay. Modules keep their list price: they are still billed monthly and the
   * prepaid discount never touched them.
   *
   * This codebase has fixed the same class of defect twice before, for
   * grandfathered modules and for phantom extra-number revenue, which is why
   * it is a parameter rather than something a caller is trusted to remember.
   */
  planCentsOverride?: number,
): number {
  return modules.reduce(
    (sum, module) => sum + MODULE_CATALOG[module].monthlyCents,
    planCentsOverride ?? PLAN_MONTHLY_REVENUE_CENTS[plan],
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
  // #400/D107: a prepaid year zeroes the licensed line, so the plan part is
  // worth what was collected spread over the months it bought — not the list
  // price nobody is paying this month.
  const open = await openPrepayment(db, companyId);
  return companyRevenueCents(
    plan,
    modules,
    open ? amortisedMonthlyUsdCents(open, PLAN_MONTHLY_REVENUE_CENTS[plan]) : undefined,
  );
}
