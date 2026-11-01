import type { Ctx } from "../context";
import {
  ACCOUNT_RATE_STALE_MS,
  CORE_SCENARIOS,
  MAX_ABANDONED_SHARE,
  MAX_SHORT_SHARE,
  PAID_DIALS_PER_DAY,
  PAID_DIALS_PER_HOUR,
  RATIOS_STALE_MS,
  RESERVE_STALE_MS,
  WINDOW_DEFAULT_START_HOUR,
  WINDOW_HOURS,
  WINDOW_STALE_MS,
} from "../limits";
import { Refusal, type RuleName } from "../refusal";
import type { PartitionView } from "../telnyx/partition";
import { balanceAboveFloor, requireAboveFloor } from "./balance";
import { limitInForce, roomUnder, type LimitInForce } from "./concurrency";
import { counted, dayOf, hourOf } from "./counters";
import { readTier } from "./ledger";
import { liveLegCount } from "./legs";
import { requirePaidLanesOpen, signalSummary } from "./signals";

/**
 * Admission for paid dials (docs/RIG.md): a test
 * call never takes the capacity a customer's call needs.
 *
 * Production's reserve, the measured window, the account's ratios and
 * production's dial peaks come from production's own records, which the
 * guard cannot read (no production database credential exists here). They
 * are filed through /admin, whose token lives only in the `guard`
 * environment, by guard.yml's `measurements` routine. Each goes stale, and a
 * stale input admits nothing rather than guessing.
 */
export interface ReserveRecord {
  /** Production's largest ring audience plus one. */
  legs: number;
  measured_at: number;
}

export interface RatiosRecord {
  calls: number;
  abandoned: number;
  short: number;
  measured_at: number;
}

export interface WindowRecord {
  start_hour: number;
  measured_at: number;
}

/** Production's most outbound legs in one UTC hour and in one UTC day over 28 days, ring legs included. */
export interface AccountRateRecord {
  peak_hour_dials: number;
  peak_day_dials: number;
  measured_at: number;
}

export const ADMISSION_KEYS = {
  reserve: "admission:reserve",
  ratios: "admission:ratios",
  window: "admission:window",
  accountRate: "admission:account-rate",
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** The window in force: the measured one while fresh, else the 04:00 default, with no measurement. */
export function windowInForce(record: WindowRecord | undefined, now: number): { startHour: number; measuredAt: number | null } {
  if (record && now - record.measured_at <= WINDOW_STALE_MS) return { startHour: record.start_hour, measuredAt: record.measured_at };
  return { startHour: WINDOW_DEFAULT_START_HOUR, measuredAt: null };
}

/** The window's first UTC hour: the measured one while fresh, else 04:00. */
export function windowStartHour(record: WindowRecord | undefined, now: number): number {
  return windowInForce(record, now).startHour;
}

export function inWindow(now: number, startHour: number): boolean {
  const hour = new Date(now).getUTCHours();
  return (hour - startHour + 24) % 24 < WINDOW_HOURS;
}

/** Room for test legs: the limit in force minus production's reserve, or null when either is unknown. */
export function roomFor(concurrency: LimitInForce, reserve: ReserveRecord | undefined, now: number): number | null {
  if (concurrency.limit === null || !reserve || now - reserve.measured_at > RESERVE_STALE_MS) return null;
  return roomUnder(concurrency, reserve.legs);
}

export function ratioRule(ratios: RatiosRecord | undefined, now: number): Refusal | null {
  if (!ratios || now - ratios.measured_at > RATIOS_STALE_MS) return new Refusal("admission.ratios_unknown");
  if (ratios.calls <= 0) return null;
  if (ratios.abandoned / ratios.calls > MAX_ABANDONED_SHARE) return new Refusal("admission.abandoned_ratio");
  if (ratios.short / ratios.calls > MAX_SHORT_SHARE) return new Refusal("admission.short_ratio");
  return null;
}

/** The rules on the limit itself: an unparseable floor, a conflict, or only the floor proven. */
export function limitRule(concurrency: LimitInForce, newLegs: number): Refusal | null {
  if (concurrency.floor === null) return new Refusal("admission.limit_unknown");
  if (concurrency.conflict) return new Refusal("admission.limit_conflict");
  if (concurrency.source === "floor" && newLegs > 0) return new Refusal("admission.limit_unproven");
  return null;
}

/**
 * The rig's dials in the last hour and the last day, from its own counters.
 * A rolling hour ending now lies inside this UTC hour and the one before it,
 * so their sum never undercounts; the day is counted the same way.
 */
async function rigDials(ctx: Ctx, now: number): Promise<{ hour: number; day: number }> {
  return {
    hour: (await counted(ctx, "dials-hour", hourOf(now))) + (await counted(ctx, "dials-hour", hourOf(now - HOUR_MS))),
    day: (await counted(ctx, "dials", dayOf(now))) + (await counted(ctx, "dials", dayOf(now - 24 * HOUR_MS))),
  };
}

/**
 * Telnyx's Paid caps are account-wide, so production's dials spend the same
 * 10 an hour and 100 a day. Production's measured peak is counted as if it
 * were happening now.
 */
export async function accountRateRule(
  ctx: Ctx,
  record: AccountRateRecord | undefined,
  newLegs: number,
  now: number,
): Promise<Refusal | null> {
  if (!record || now - record.measured_at > ACCOUNT_RATE_STALE_MS) return new Refusal("admission.account_rate_unknown");
  const rig = await rigDials(ctx, now);
  if (rig.hour + newLegs + record.peak_hour_dials > PAID_DIALS_PER_HOUR) return new Refusal("admission.account_hour_full");
  if (rig.day + newLegs + record.peak_day_dials > PAID_DIALS_PER_DAY) return new Refusal("admission.account_day_full");
  return null;
}

/**
 * What production has up right now, across its connections:
 *   - `live` or `idle`: a connection answered, and whether a call is up;
 *   - `absent`: every connection answered that the read does not exist or
 *     does not apply to it (404, 422). The active-calls API is unverified for
 *     this account, and its absence leaves the room formula as the only
 *     protection, as the design's fallback says;
 *   - `unknown`: a read failed in a way that may pass (429, 5xx, the network),
 *     or no production connection is known. Nothing is admitted on it, and the
 *     poll keeps asking.
 */
export type ProductionCalls = "live" | "idle" | "absent" | "unknown";

export async function productionCalls(ctx: Ctx, view: PartitionView): Promise<ProductionCalls> {
  const ids = view.record.production.connection_ids;
  if (!ctx.telnyx || ids.length === 0) return "unknown";
  let answered = false;
  let failed = false;
  for (const id of ids) {
    let status: number;
    let body: unknown;
    try {
      ({ status, body } = await ctx.telnyx.send("GET", `/v2/connections/${encodeURIComponent(id)}/active_calls`));
    } catch {
      failed = true;
      continue;
    }
    if (status === 404 || status === 422) continue;
    if (status !== 200) {
      failed = true;
      continue;
    }
    answered = true;
    const data = (body as { data?: unknown[] } | undefined)?.data;
    if (Array.isArray(data) && data.length > 0) return "live";
  }
  if (failed) return "unknown";
  return answered ? "idle" : "absent";
}

export interface PaidRequest {
  /** Legs this request adds: 1 for a dial or transfer, 0 for a bridge. */
  newLegs: number;
  scenario: string | null;
}

/** What admission saw, for reading a refusal Telnyx gives the request afterwards. */
export interface Admitted {
  /** The rig's live legs before this request; null when it adds none. */
  liveLegs: number | null;
  production: ProductionCalls | null;
}

/**
 * Every admission rule, cheapest first. Throws the first {@link Refusal}
 * that applies. Nothing here dials to learn anything.
 */
export async function admitPaid(ctx: Ctx, view: PartitionView, request: PaidRequest): Promise<Admitted> {
  await requirePaidLanesOpen(ctx);
  const now = ctx.now();
  const concurrency = await limitInForce(ctx);
  const limit = limitRule(concurrency, request.newLegs);
  if (limit) throw limit;

  const window = await ctx.store.get<WindowRecord>(ADMISSION_KEYS.window);
  if (!inWindow(now, windowStartHour(window, now))) throw new Refusal("admission.outside_window");

  const rate = await accountRateRule(ctx, await ctx.store.get<AccountRateRecord>(ADMISSION_KEYS.accountRate), request.newLegs, now);
  if (rate) throw rate;

  const ratio = ratioRule(await ctx.store.get<RatiosRecord>(ADMISSION_KEYS.ratios), now);
  if (ratio) throw ratio;

  const room = roomFor(concurrency, await ctx.store.get<ReserveRecord>(ADMISSION_KEYS.reserve), now);
  if (room === null) throw new Refusal("admission.reserve_unknown");

  const tier = await readTier(ctx);
  if (tier.tier === "red") throw new Refusal("budget.tier_red");
  if (tier.tier === "amber" && !(request.scenario && CORE_SCENARIOS.includes(request.scenario))) {
    throw new Refusal("budget.tier_amber");
  }
  await requireAboveFloor(ctx);

  if (request.newLegs === 0) return { liveLegs: null, production: null };
  const liveLegs = await liveLegCount(ctx);
  if (liveLegs + request.newLegs > room) throw new Refusal("admission.no_room");
  const production = await productionCalls(ctx, view);
  if (production === "live") throw new Refusal("admission.production_call_live");
  if (production === "unknown") throw new Refusal("admission.production_calls_unknown");
  return { liveLegs, production };
}

export interface PaidState {
  /** The rules that would stop a one-leg dial now, in /health's order. */
  blockers: RuleName[];
  room: number | null;
  concurrency: LimitInForce;
  accountRate: AccountRateRecord | null;
  window: { startHour: number; measuredAt: number | null };
  balance: number | null;
  balanceAbove: boolean;
}

/**
 * Whether a paid dial would be admitted now, rule by rule, as /health shows
 * it and as standing orders read it. `safety` is the start-up checks' state.
 */
export async function paidState(ctx: Ctx, safety: "ok" | "unsafe" | "unconfigured" | "unchecked"): Promise<PaidState> {
  const now = ctx.now();
  const blockers: RuleName[] = [];
  if (!ctx.telnyx) blockers.push("telnyx.key_missing");
  if (safety !== "ok") blockers.push(safety === "unsafe" ? "startup.unsafe" : "startup.unconfigured");
  const concurrency = await limitInForce(ctx);
  const limit = limitRule(concurrency, 1);
  if (limit) blockers.push(limit.rule);
  const room = roomFor(concurrency, await ctx.store.get<ReserveRecord>(ADMISSION_KEYS.reserve), now);
  if (concurrency.limit !== null && room === null) blockers.push("admission.reserve_unknown");
  const accountRate = (await ctx.store.get<AccountRateRecord>(ADMISSION_KEYS.accountRate)) ?? null;
  const rate = await accountRateRule(ctx, accountRate ?? undefined, 1, now);
  if (rate) blockers.push(rate.rule);
  const ratio = ratioRule(await ctx.store.get<RatiosRecord>(ADMISSION_KEYS.ratios), now);
  if (ratio) blockers.push(ratio.rule);
  const signals = await signalSummary(ctx);
  if (signals.latched) blockers.push("signal.latched");
  else if (signals.halted_until) blockers.push("signal.halted");
  if ((await readTier(ctx)).tier === "red") blockers.push("budget.tier_red");
  const { balance, above } = ctx.telnyx ? await balanceAboveFloor(ctx) : { balance: null, above: false };
  if (ctx.telnyx && balance === null) blockers.push("budget.balance_unknown");
  if (balance !== null && !above) blockers.push("budget.balance_floor");
  return {
    blockers,
    room,
    concurrency,
    accountRate,
    window: windowInForce(await ctx.store.get<WindowRecord>(ADMISSION_KEYS.window), now),
    balance,
    balanceAbove: above,
  };
}
