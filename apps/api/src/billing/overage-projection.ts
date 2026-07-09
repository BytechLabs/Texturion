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
 * - FLOW usage (outbound/inbound segments, voice, outbound MMS, egress) accrues
 *   over the period, so its volume is extrapolated to month-end by
 *   periodDays/elapsedDays, then priced with UNIT_COST_CENTS (costs.ts).
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
 *   cleared the cap), because sending pauses there. Voice + MMS are cap-and-drop,
 *   so their projected volume is capped at the plan ceiling. The uncovered,
 *   uncapped driver is INBOUND segments (0.7c each, free to the customer) —
 *   priced in full with no offsetting revenue. That is exactly the loss the
 *   dynamic warning exists to catch.
 * - KNOWN GAP: the ~$0.10 per-forwarded-call transfer fee is not yet modeled
 *   (there is no forwarded-call-COUNT metric; only voice seconds are summed), so
 *   a high-frequency short-call pattern can under-count voice cost. Tracked in
 *   #98; the voice cap-and-drop (300 min) + the $8 module price are a partial
 *   backstop until then.
 * - Revenue is NET of Stripe's cut (stripeNetCents) — the money we actually keep.
 * - STALE-PERIOD FAIL-SAFE: the multiplier is clamped to >= 1, so an overdue
 *   period (renewal webhook not yet fired, elapsed > periodDays) can never scale
 *   observed cost DOWN and hide a loss (never under-count).
 * - EARLY-PERIOD GUARD: `trendingOver` stays false until MIN_ELAPSED_DAYS have
 *   passed, because a one-day extrapolation (x30) is noise, not signal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  companyRevenueCents,
  FIXED_MONTHLY_COST_CENTS,
  stripeNetCents,
  UNIT_COST_CENTS,
} from "./costs";
import { enabledModules } from "./company-modules";
import {
  PLAN_INCLUDED_SEGMENTS,
  PLAN_MMS_INCLUDED,
  PLAN_OVERAGE_CENTS_PER_SEGMENT,
  PLAN_VOICE_MINUTES,
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
  /** Forwarded voice seconds this period (api_period_voice_seconds). */
  voiceSeconds: number;
  /** Outbound MMS count this period (api_period_outbound_mms). */
  outboundMms: number;
  /** Signed-URL egress bytes this period (api_period_egress_bytes). */
  egressBytes: number;
  /** Current stored bytes, both pools combined (api_storage_usage) — a STOCK. */
  storageBytes: number;
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

export interface ProjectedUsage {
  /** Provider cost of all extrapolated flow usage, in cents (full outbound). */
  costCents: number;
  /** Billable outbound overage revenue (GROSS), in cents — offsets its own cost
   *  and then some, so a paying-heavy tenant is not flagged. */
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
  const projectedVoiceSeconds = Math.min(
    usage.voiceSeconds * multiplier,
    PLAN_VOICE_MINUTES[plan] * 60,
  );
  const projectedMms = Math.min(
    usage.outboundMms * multiplier,
    PLAN_MMS_INCLUDED[plan],
  );
  const projectedEgressBytes = usage.egressBytes * multiplier;

  const costCents =
    projectedOutbound * UNIT_COST_CENTS.outboundSegment +
    projectedInbound * UNIT_COST_CENTS.inboundSegment +
    (projectedVoiceSeconds / 60) * UNIT_COST_CENTS.voiceMinute +
    projectedMms * UNIT_COST_CENTS.outboundMms +
    (projectedEgressBytes / GB) * UNIT_COST_CENTS.egressGb;

  const overageRevenueGrossCents =
    Math.max(0, projectedOutbound - includedSegments) *
    PLAN_OVERAGE_CENTS_PER_SEGMENT[plan];

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

/** Read the period's usage totals from the six period-sum RPCs. */
export async function readPeriodUsage(
  db: SupabaseClient,
  company: OverageCompany,
): Promise<PeriodUsage> {
  const windowed = {
    p_company_id: company.id,
    p_since: company.current_period_start,
  };
  const [outbound, inbound, voiceSeconds, outboundMms, egressBytes, storage] =
    await Promise.all([
      rpcNumber(db, "api_period_segments", windowed),
      rpcNumber(db, "api_period_inbound_segments", windowed),
      rpcNumber(db, "api_period_voice_seconds", windowed),
      rpcNumber(db, "api_period_outbound_mms", windowed),
      rpcNumber(db, "api_period_egress_bytes", windowed),
      (async () => {
        const { data, error } = await db.rpc("api_storage_usage", {
          p_company_id: company.id,
        });
        if (error) throw new Error(`api_storage_usage failed: ${error.message}`);
        const s = data as {
          attachments_bytes: number | string;
          mms_bytes: number | string;
        };
        return Number(s.attachments_bytes) + Number(s.mms_bytes);
      })(),
    ]);
  return {
    outboundSegments: outbound,
    inboundSegments: inbound,
    voiceSeconds,
    outboundMms,
    egressBytes,
    storageBytes: storage,
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
  const [usage, numbers, baseRevenueGrossCents] = await Promise.all([
    readPeriodUsage(db, company),
    countActiveNumbers(db, company.id),
    companyMonthlyRevenueGrossCents(db, company),
  ]);
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

/** Gross monthly revenue (plan + enabled modules) for a company. */
async function companyMonthlyRevenueGrossCents(
  db: SupabaseClient,
  company: OverageCompany,
): Promise<number> {
  const modules = await enabledModules(db, company.id);
  return companyRevenueCents(company.plan, modules);
}
