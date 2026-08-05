/**
 * #85 (child 2 / #91) — cost-so-far aggregation, end-of-period extrapolation,
 * and the pure overage DECISION function.
 *
 * The question this answers, per company per period: "extrapolating from usage
 * so far, will this tenant COST us more than they PAY us by the end of the
 * billing period?" If yes, the tenant is trending over and (in later children)
 * gets a warning + overage controls; otherwise we stay silent. This module is
 * pure logic + read-only DB aggregation — no email, no cron wiring, no UI, no
 * write — so it ships with zero behavior change and is exhaustively testable.
 *
 * MODEL (documented decisions):
 * - FLOW usage (outbound/inbound segments, voice minutes + forwarded-call
 *   transfers, egress) accrues over the period, so its volume is extrapolated
 *   to month-end by periodDays/elapsedDays, then priced with UNIT_COST_CENTS
 *   (costs.ts).
 * - MMS has NO separate term (#103): every outbound MMS meters as 3 segments
 *   into usage_events (messaging/status.ts), so it is already inside
 *   outboundSegments at 3 × 0.85¢ = 2.55¢ ≥ its ~2.5¢ true cost — and it bills
 *   customer overage through the same segments. A dedicated MMS line would
 *   DOUBLE-count (the pre-#103 model did exactly that).
 * - STORAGE is a STOCK, not a flow (api_storage_usage is a point-in-time total).
 *   Extrapolating it by elapsed days would wildly over-count (5 GB on day 2 ->
 *   x15). We price the CURRENT stock as the month's storage cost, un-extrapolated.
 * - FIXED monthly cost (number rental + the US 10DLC campaign fee) does not
 *   scale with usage, so it is added at its full monthly value, not extrapolated.
 * - OVERAGE is modeled on BOTH sides so a heavy-but-PAYING tenant is not falsely
 *   flagged: outbound segments beyond the included allowance are priced at their
 *   full cost AND their overage REVENUE (3c/2.5c, a surplus over the 0.85c cost)
 *   is added to revenue. Projected outbound is bounded by the spending-cap
 *   ceiling (included x overage_cap_multiplier, or unbounded when the owner
 *   cleared the cap), because sending pauses there. Voice MINUTES (D36) pause
 *   at the SAME spending cap, so their projected volume is bounded by
 *   allowance × multiplier and the minutes beyond the allowance earn 1¢/min
 *   overage revenue — but the per-forwarded-call TRANSFER fee is NOT bounded
 *   (call count isn't bounded by the
 *   minute cap), so it is extrapolated uncapped. The uncovered, uncapped drivers
 *   are INBOUND segments (0.7c each, free to the customer) and those transfers —
 *   priced in full with no offsetting revenue. That is exactly the loss the
 *   dynamic warning exists to catch.
 * - The ~$0.10 per-forwarded-call transfer fee IS modeled (#98): forwarded-call
 *   COUNT (api_period_forwarded_calls) is extrapolated and priced at
 *   UNIT_COST_CENTS.voiceTransfer. The minute ceiling cannot bound it — a run
 *   of very short calls accrues near-zero minutes and a real $0.10 each — so
 *   #448 gave it its own count ceiling (`dialCeilings`), and the projection is
 *   clamped to that, the same way the minute term is clamped to the minute cap.
 * - AI (#380) is priced per REQUEST from company_ai_usage, extrapolated on the
 *   same multiplier as the other flows. It was previously absent entirely: every
 *   AI feature declared a cap, an alert and a timeout — all of which bound how
 *   BAD it can get — and none of them told this model it was happening.
 * - Revenue is NET of Stripe's cut (stripeNetCents) — the money we actually keep.
 * - STALE-PERIOD FAIL-SAFE: the multiplier is clamped to >= 1, so an overdue
 *   period (renewal webhook not yet fired, elapsed > periodDays) can never scale
 *   observed cost DOWN and hide a loss (never under-count).
 * - EARLY-PERIOD GUARD: `trendingOver` stays false until MIN_ELAPSED_DAYS have
 *   passed, because a one-day extrapolation (x30) is noise, not signal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { readUsageWindow } from "./usage-window";
import { storedBytes, type StorageUsageRow } from "./stored-bytes";

import {
  AI_UNIT_COST_CENTS,
  type AiCostFeature,
  companyRevenueCents,
  FIXED_MONTHLY_COST_CENTS,
  PLAN_MONTHLY_REVENUE_CENTS,
  stripeNetCents,
  UNIT_COST_CENTS,
} from "./costs";
import { enabledModuleFlags } from "./company-modules";
import { periodProviderCostCents } from "./provider-costs";
import { EXTRA_NUMBER_MONTHLY_CENTS } from "./extra-numbers";
import { amortisedMonthlyCents, openPrepayment } from "./prepay";
import {
  dialCeilings,
  PLAN_INCLUDED_SEGMENTS,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
  type PlanId,
} from "./plans";

const DAY_MS = 86_400_000;
const GB = 1024 ** 3;

/** Whole days before a one-off extrapolation is trusted enough to warn on. */
export const MIN_ELAPSED_DAYS_FOR_WARNING = 2;

/**
 * Warn when projected cost reaches this fraction of net revenue — below 1.0 so
 * the owner hears BEFORE the tenant actually goes underwater (cost-protection
 * mandate: alert before the cap, not after).
 */
export const WARN_COST_FRACTION = 0.9;

/** Fallback period length when `current_period_end` is missing (a normal month). */
export const DEFAULT_PERIOD_DAYS = 30;

/** Point-in-time usage totals for the current period (from the period-sum RPCs). */
export interface PeriodUsage {
  /** Outbound SMS segments this period (api_period_segments). */
  outboundSegments: number;
  /** Inbound SMS segments this period (api_period_inbound_segments). */
  inboundSegments: number;
  /** Forwarded (dialed-leg) voice seconds this period
   *  (api_period_forward_seconds) — D36: the billed customer-facing measure;
   *  UNIT_COST_CENTS.voiceMinute prices BOTH legs' cost per forwarded minute. */
  voiceSeconds: number;
  /** Forwarded-call COUNT this period (api_period_forwarded_calls) — the
   *  per-transfer fee scales with this, not with seconds. */
  forwardedCalls: number;
  /** Signed-URL egress bytes this period (api_period_egress_bytes). */
  egressBytes: number;
  /** Current stored bytes, both pools combined (api_storage_usage) — a STOCK. */
  storageBytes: number;
  /** #216: ACTUAL Telnyx telecom cost so far this period, in CENTS (voice
   *  ledger + message COGS, api_period_provider_cost). The projection prices
   *  telecom as max(estimate, this × multiplier) so ground truth catches
   *  estimate misses without ever under-counting during the cost-webhook lag. */
  actualTelecomCostCents: number;
  /**
   * #380: AI requests this period, per `company_ai_usage.feature`
   * (api_period_ai_requests).
   *
   * Every AI feature was already CALLED a cost centre, metered per company,
   * capped per company and alerted on per company — and then left out of the
   * one model whose job is deciding whether a company is profitable. A cap
   * bounds how bad it can get; it does not notice that it is happening.
   */
  aiRequests: Record<string, number>;
}

export interface OverageDecision {
  /** True when the tenant is projected to cost near/over what they pay (and
   *  enough of the period has elapsed to trust the projection). */
  trendingOver: boolean;
  /** Projected month-end total provider cost, in cents. */
  extrapolatedCostCents: number;
  /** Net monthly revenue (after Stripe fees), in cents. */
  revenueCents: number;
  /** revenueCents - extrapolatedCostCents (negative = projected loss). */
  marginCents: number;
  /** Projected month-end TOTAL overage the CUSTOMER will be billed, in cents
   *  (gross, before Stripe) — outbound-segment overage PLUS voice-minute
   *  overage (both metered surfaces). Customer-facing "$X extra this period".
   *  Distinct from the internal cost/margin above, which are ours and must not
   *  be exposed to the customer. */
  projectedOverageChargesCents: number;
  /** Days elapsed in the current period at `now`. */
  elapsedDays: number;
  /** Nominal length of the current period in days. */
  periodDays: number;
}

/** Period timing from the company's Stripe-mirrored window. */
export function periodTiming(
  periodStart: string | Date,
  periodEnd: string | Date | null,
  now: Date,
): { periodDays: number; elapsedDays: number } {
  const start = new Date(periodStart).getTime();
  const end = periodEnd
    ? new Date(periodEnd).getTime()
    : start + DEFAULT_PERIOD_DAYS * DAY_MS;
  const periodDays = Math.max(1, (end - start) / DAY_MS);
  const elapsedDays = Math.max(0, (now.getTime() - start) / DAY_MS);
  return { periodDays, elapsedDays };
}

/**
 * Month-end extrapolation multiplier for flow usage. Clamped to >= 1: it only
 * ever scales observed cost UP or leaves it flat, never down — so an overdue /
 * stale period cannot hide a real cost (the fail-safe).
 */
export function extrapolationMultiplier(
  periodDays: number,
  elapsedDays: number,
): number {
  return Math.max(1, periodDays / Math.max(elapsedDays, 1));
}

/** The month-end outbound-segment ceiling: sending pauses at the spending cap
 *  (included x multiplier), or is unbounded when the owner cleared the cap. */
export function outboundCeiling(
  plan: PlanId,
  overageCapMultiplier: number | null,
): number {
  return overageCapMultiplier === null
    ? Infinity
    : PLAN_INCLUDED_SEGMENTS[plan] * overageCapMultiplier;
}

/** D36: the month-end calling-seconds ceiling — calling pauses at the
 *  SAME spending cap as texts (allowance × multiplier), no longer at the
 *  allowance itself. (#134/D42: the grandfathered legacy ceiling retired
 *  with the module.) */
export function voiceCeilingSeconds(
  plan: PlanId,
  overageCapMultiplier: number | null,
): number {
  return overageCapMultiplier === null
    ? Infinity
    : PLAN_VOICE_MINUTES[plan] * 60 * overageCapMultiplier;
}

export interface ProjectedUsage {
  /** Provider cost of all extrapolated flow usage, in cents (full outbound). */
  costCents: number;
  /** Billable overage revenue (GROSS), in cents — outbound segments beyond the
   *  quota at 3¢/2.5¢ PLUS forwarded minutes beyond the voice allowance at
   *  1¢/min (D36) — offsets its own cost so a paying-heavy tenant is not
   *  flagged. NB: voice overage sells ~0.2¢/min UNDER its 1.2¢ combined-leg
   *  cost (founder call, D36) — counting the revenue keeps the warning honest
   *  without hiding that structural sliver, which stays inside costCents. */
  overageRevenueGrossCents: number;
}

/**
 * Project the FLOW usage to month-end: each volume extrapolated by `multiplier`,
 * priced at its full cost, and the outbound overage revenue computed. Outbound
 * is bounded by the spending-cap ceiling; voice + MMS by the cap-and-drop plan
 * ceilings. Inbound is uncapped and unpriced-to-customer (the loss driver).
 */
export function projectUsage(
  usage: PeriodUsage,
  plan: PlanId,
  overageCapMultiplier: number | null,
  multiplier: number,
): ProjectedUsage {
  const includedSegments = PLAN_INCLUDED_SEGMENTS[plan];
  const ceiling = outboundCeiling(plan, overageCapMultiplier);

  const projectedOutbound = Math.min(usage.outboundSegments * multiplier, ceiling);
  const projectedInbound = usage.inboundSegments * multiplier;
  // D36: voice pauses at the spending cap, not the allowance — minutes
  // between the two BILL at 1¢/min (counted into overage revenue below).
  const projectedVoiceSeconds = Math.min(
    usage.voiceSeconds * multiplier,
    voiceCeilingSeconds(plan, overageCapMultiplier),
  );
  // The per-transfer fee is per CALL, so the voice spending cap — which bounds
  // MINUTES — cannot bound it (#98). #448 gave it a ceiling of its own, and the
  // projection is clamped to that ceiling for the same reason the minute
  // projection is clamped to the minute cap: past it, calling stops, so a
  // month-end figure above it is a cost that cannot actually be reached.
  const projectedForwardedCalls = Math.min(
    usage.forwardedCalls * multiplier,
    dialCeilings(plan, overageCapMultiplier).stopAt,
  );
  const projectedEgressBytes = usage.egressBytes * multiplier;

  // #103: no MMS term — each MMS is already 3 of outboundSegments (see header).
  // Estimated telecom (SMS + voice) from usage units × assumed rates.
  const estimatedTelecomCents =
    projectedOutbound * UNIT_COST_CENTS.outboundSegment +
    projectedInbound * UNIT_COST_CENTS.inboundSegment +
    (projectedVoiceSeconds / 60) * UNIT_COST_CENTS.voiceMinute +
    projectedForwardedCalls * UNIT_COST_CENTS.voiceTransfer;
  // #216: actual Telnyx telecom cost so far, extrapolated to month-end on the
  // SAME multiplier. Take the HIGHER of estimate vs actual: ground truth catches
  // estimate misses (e.g. Canada SMS costs more than our per-segment estimate),
  // while the estimate covers the lag before a call/message is costed — so the
  // never-lose-money model can never UNDER-count telecom.
  const telecomCents = Math.max(
    estimatedTelecomCents,
    usage.actualTelecomCostCents * multiplier,
  );
  // #380: AI. Extrapolated on the same multiplier as every other flow, priced
  // per REQUEST because that is the unit the ledger counts. An unpriced feature
  // key contributes 0 rather than throwing — the type system already stops one
  // being DECLARED without a price, so this only covers historic rows for a
  // retired key.
  const projectedAiCents = Object.entries(usage.aiRequests).reduce(
    (sum, [feature, requests]) =>
      sum +
      requests *
        multiplier *
        (AI_UNIT_COST_CENTS[feature as AiCostFeature] ?? 0),
    0,
  );

  const costCents =
    telecomCents +
    (projectedEgressBytes / GB) * UNIT_COST_CENTS.egressGb +
    projectedAiCents;

  const projectedVoiceOverageMinutes = Math.max(
    0,
    projectedVoiceSeconds / 60 - PLAN_VOICE_MINUTES[plan],
  );
  const overageRevenueGrossCents =
    Math.max(0, projectedOutbound - includedSegments) *
      PLAN_OVERAGE_CENTS_PER_SEGMENT[plan] +
    projectedVoiceOverageMinutes * VOICE_OVERAGE_CENTS_PER_MINUTE;

  return { costCents, overageRevenueGrossCents };
}

/** Current stored stock priced as the month's storage cost, in cents. */
export function storageMonthlyCostCents(storageBytes: number): number {
  return (storageBytes / GB) * UNIT_COST_CENTS.storageGbMonth;
}

/** Fixed monthly cost the revenue must cover regardless of usage, in cents. */
export function fixedMonthlyCostCents(inputs: {
  numbers: number;
  usTextingEnabled: boolean;
}): number {
  return (
    inputs.numbers * FIXED_MONTHLY_COST_CENTS.perNumber +
    (inputs.usTextingEnabled ? FIXED_MONTHLY_COST_CENTS.us10dlcCampaign : 0)
  );
}

/**
 * The pure decision: assemble the projected month-end cost from raw usage +
 * plan + fixed inputs and compare it to net revenue. Everything is data in,
 * decision out — no I/O — so it is exhaustively unit-testable.
 */
export function overageDecision(
  inputs: {
    usage: PeriodUsage;
    plan: PlanId;
    /** companies.overage_cap_multiplier (null = owner cleared the cap). */
    overageCapMultiplier: number | null;
    numbers: number;
    usTextingEnabled: boolean;
    /** GROSS monthly plan + module revenue, before overage and Stripe fees. */
    baseRevenueGrossCents: number;
    periodStart: string | Date;
    periodEnd: string | Date | null;
  },
  now: Date,
): OverageDecision {
  const { periodDays, elapsedDays } = periodTiming(
    inputs.periodStart,
    inputs.periodEnd,
    now,
  );
  const multiplier = extrapolationMultiplier(periodDays, elapsedDays);
  const projected = projectUsage(
    inputs.usage,
    inputs.plan,
    inputs.overageCapMultiplier,
    multiplier,
  );
  const extrapolatedCostCents =
    projected.costCents +
    storageMonthlyCostCents(inputs.usage.storageBytes) +
    fixedMonthlyCostCents({
      numbers: inputs.numbers,
      usTextingEnabled: inputs.usTextingEnabled,
    });
  // Overage is billed, so its revenue counts (net of Stripe alongside the base).
  const revenueCents = stripeNetCents(
    inputs.baseRevenueGrossCents + projected.overageRevenueGrossCents,
  );
  const marginCents = revenueCents - extrapolatedCostCents;
  const trendingOver =
    elapsedDays >= MIN_ELAPSED_DAYS_FOR_WARNING &&
    extrapolatedCostCents > revenueCents * WARN_COST_FRACTION;
  return {
    trendingOver,
    extrapolatedCostCents,
    revenueCents,
    marginCents,
    projectedOverageChargesCents: projected.overageRevenueGrossCents,
    elapsedDays,
    periodDays,
  };
}

/** The company row shape `decideOverage` reads its period + registration from. */
export interface OverageCompany {
  id: string;
  plan: PlanId;
  current_period_start: string;
  current_period_end: string | null;
  us_texting_enabled: boolean;
  /** companies.overage_cap_multiplier — null means the owner cleared the cap. */
  overage_cap_multiplier: number | null;
  /**
   * companies.paid_extra_numbers — the extra-number quantity actually BILLED
   * (mirrored from Stripe, #110). Used for the revenue term so the loss
   * projection counts real revenue, not a count derived from the live number
   * list (which can diverge from what Stripe charges).
   */
  paid_extra_numbers: number;
  /**
   * #277 — what the plan line is actually worth this month when the workspace
   * is PAUSED, in cents, mirrored from the Stripe item (companies.paused_price_cents).
   *
   * A pause is a licensed-price swap, so `plan` still reads 'starter' or 'pro'
   * and `subscription_status` still reads 'active' — meaning this job selects
   * paused tenants and, without this, would credit each of them with the full
   * $29 or $79 they are conspicuously not paying. That mutes the one alert that
   * catches a tenant costing more than it pays, for the cohort whose revenue
   * just fell by roughly ninety per cent while its cost (a number, a live 10DLC
   * campaign, and uncapped inbound) barely moved.
   *
   * It is a field rather than something a caller is trusted to remember because
   * this codebase has now fixed the identical defect four times — grandfathered
   * modules, phantom extra numbers, the prepaid year, and this.
   *
   * Optional: absent or null means the amount is UNREADABLE, which is not the
   * same thing as "not paused" — see `paused_at` below, which is the field this
   * job branches on.
   */
  paused_price_cents?: number | null;
  /**
   * #277 — WHETHER the workspace is paused. `companies.paused_at`.
   *
   * The fact and the amount are separate fields because they fail separately,
   * and branching on the amount is the same mis-valuation this whole block
   * exists to prevent, one level down. `paused_price_cents` is null whenever the
   * fee cannot be read — a tiered pause price (no `unit_amount`), a workspace
   * paused before `pausePriceSnapshot` started refusing those, or the window
   * between syncSubscription's two writes, which stamp the fact and the fee as
   * separate PATCHes. Every one of those reads "not paused" to a test on the
   * amount, and the tenant is then credited with the $29 or $79 it is
   * conspicuously not paying — the exact alert-muting this field was added to
   * stop.
   *
   * So: branch on the FACT, and when the amount is missing count ZERO rather
   * than guessing. Zero is the conservative direction for an alert whose job is
   * to make somebody LOOK at a row — whatever a paused workspace is paying, it
   * is certainly not paying for the plan. Same posture as
   * scripts/ops/pricing-report.mjs, which reports the same cohort.
   *
   * Optional: absent or null means not paused, which is every ordinary tenant.
   */
  paused_at?: string | null;
}

async function rpcNumber(
  db: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await db.rpc(fn, params);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return Number(data);
}

/** Read the period's usage totals: the #304 window, plus the cost arms. */
export async function readPeriodUsage(
  db: SupabaseClient,
  company: OverageCompany,
): Promise<PeriodUsage> {
  const windowed = {
    p_company_id: company.id,
    p_since: company.current_period_start,
  };
  const [
    totals,
    forwardedCalls,
    egressBytes,
    actualTelecomCostCents,
    aiRequests,
    storage,
  ] = await Promise.all([
    // #304: segments, inbound and voice in ONE question. These three used to
    // be three separate `>= since` reads here AND three more on the usage
    // route, for the same company over the same period — six round trips for
    // one answer, and two places that could drift apart. `to: null` is the
    // same open-ended period these RPCs always meant.
    readUsageWindow(db, company.id, {
      from: company.current_period_start,
      to: null,
    }),
    rpcNumber(db, "api_period_forwarded_calls", windowed),
    rpcNumber(db, "api_period_egress_bytes", windowed),
    periodProviderCostCents(db, company.id, company.current_period_start),
    (async () => {
      const { data, error } = await db.rpc("api_period_ai_requests", windowed);
      // Best-effort: AI is cents at current volumes, and losing it must never
      // take down the whole profitability answer with it.
      if (error) return {} as Record<string, number>;
      const raw = (data ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, Number(v) || 0]),
      );
    })(),
    (async () => {
      const { data, error } = await db.rpc("api_storage_usage", {
        p_company_id: company.id,
      });
      if (error) throw new Error(`api_storage_usage failed: ${error.message}`);
      return storedBytes(data as StorageUsageRow);
    })(),
  ]);
  return {
    outboundSegments: totals.outboundSegments,
    inboundSegments: totals.inboundSegments,
    voiceSeconds: totals.voiceSeconds,
    forwardedCalls,
    egressBytes,
    aiRequests,
    storageBytes: storage,
    actualTelecomCostCents,
  };
}

/** Count the company's numbers that still cost us rent (not released). */
async function countActiveNumbers(
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

/**
 * The DB orchestrator: read usage + numbers + revenue for a company and return
 * the {@link overageDecision}. Read-only; no writes, no side effects — child 3
 * wires it into the hourly cron to send a warning, child 4 surfaces it in
 * GET /v1/usage.
 */
export async function decideOverage(
  db: SupabaseClient,
  company: OverageCompany,
  now: Date = new Date(),
): Promise<OverageDecision> {
  const [usage, numbers, moduleFlags] = await Promise.all([
    readPeriodUsage(db, company),
    countActiveNumbers(db, company.id),
    enabledModuleFlags(db, company.id),
  ]);
  // Gross monthly revenue: plan + PAID modules + #105 paid extra numbers
  // (each extra beyond the included count bills its per-plan price, so its
  // rent in fixedMonthlyCostCents is offset by real revenue, not flagged as
  // a loss). #133: a grandfathered module bills nothing — counting its price
  // as revenue would inflate the margin and mute the warning. #134/D42:
  // voice retired (calling included) — no voice module revenue exists and
  // every tenant projects against the plan allowance.
  const paidModules = moduleFlags
    .filter((m) => !m.grandfathered)
    .map((m) => m.module);
  // Revenue uses the BILLED extra quantity (paid_extra_numbers), not a count
  // derived from `numbers` — the live number list can differ from what Stripe
  // actually charges (mid-change, released-but-unsynced), which would inflate
  // revenue with phantom dollars and mute the loss warning. `numbers` stays the
  // COST/rent term below (what we actually pay Telnyx for).
  // #400/D107: a prepaid year invoices the licensed line at $0, so counting the
  // list price here would mute the underwater alert for twelve months — for the
  // one cohort that has already paid everything it will ever pay. Same class of
  // defect as the grandfathered-module and phantom-extra-number cases above.
  const openPrepaid = await openPrepayment(db, company.id);
  // #277: a pause overrides the plan price outright. It cannot coexist with a
  // prepaid year — pauseEligibility refuses one while the other is open,
  // precisely because the year's coupon rides the licensed item a pause would
  // swap — so this is an ordered choice rather than an arithmetic one.
  //
  // Keyed on `paused_at`, the FACT, and NOT on the fee being non-null: a paused
  // workspace whose fee we cannot read must be counted at zero, never handed
  // back its plan's list price. See the field's own comment for the three ways
  // the fee goes missing while the pause is perfectly real.
  const planCentsOverride =
    (company.paused_at ?? null) !== null
      ? (company.paused_price_cents ?? 0)
      : openPrepaid
        ? amortisedMonthlyCents(openPrepaid, PLAN_MONTHLY_REVENUE_CENTS[company.plan])
        : undefined;
  const baseRevenueGrossCents =
    companyRevenueCents(company.plan, paidModules, planCentsOverride) +
    company.paid_extra_numbers * EXTRA_NUMBER_MONTHLY_CENTS[company.plan];
  return overageDecision(
    {
      usage,
      plan: company.plan,
      overageCapMultiplier: company.overage_cap_multiplier,
      numbers,
      usTextingEnabled: company.us_texting_enabled,
      baseRevenueGrossCents,
      periodStart: company.current_period_start,
      periodEnd: company.current_period_end,
    },
    now,
  );
}
