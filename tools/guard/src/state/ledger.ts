import type { Ctx } from "../context";
import { AMBER_SHARE, COST_USD, MONTHLY_CAP_USD } from "../limits";
import { dayOf, monthOf } from "./counters";

/**
 * The money ledger (docs/RIG.md). Telnyx spend
 * is charged here before the request that causes it, at the conservative
 * rates in limits.ts, and the month's actual usage from detail records can be
 * filed beside it; the larger of the two is what counts.
 *
 * $35 a month all-in: this month's rentals, the reserve for next month's, and
 * one-time fees all come off the cap before usage gets a cent.
 */
export interface MonthLedger {
  usage_usd: number;
  one_time_usd: number;
  /** Actual usage for the month, from detail records. Never lowers the estimate. */
  reconciled_usd: number;
  /** The most numbers held at any point this month: each is a month's rental. */
  peak_numbers: number;
  caller_name_numbers: number;
}

export type Tier = "green" | "amber" | "red";

export interface TierReading {
  tier: Tier;
  month: string;
  usage_budget_usd: number;
  month_to_date_usd: number;
  today_usd: number;
  daily_allowance_usd: number;
  rentals_usd: number;
  next_month_reserve_usd: number;
}

const EMPTY: MonthLedger = {
  usage_usd: 0,
  one_time_usd: 0,
  reconciled_usd: 0,
  peak_numbers: 0,
  caller_name_numbers: 0,
};

function monthKey(month: string): string {
  return `money:month:${month}`;
}

function dayKey(day: string): string {
  return `money:day:${day}`;
}

/** Cents are floats here; round so 0.1 + 0.2 never tips a tier. */
function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export async function monthLedger(ctx: Ctx, month = monthOf(ctx.now())): Promise<MonthLedger> {
  return { ...EMPTY, ...(await ctx.store.get<MonthLedger>(monthKey(month))) };
}

async function putMonth(ctx: Ctx, ledger: MonthLedger): Promise<void> {
  await ctx.store.put(monthKey(monthOf(ctx.now())), ledger);
}

export async function charge(ctx: Ctx, amount: number, kind: "usage" | "one_time" = "usage"): Promise<void> {
  const ledger = await monthLedger(ctx);
  if (kind === "usage") ledger.usage_usd = usd(ledger.usage_usd + amount);
  else ledger.one_time_usd = usd(ledger.one_time_usd + amount);
  await putMonth(ctx, ledger);
  if (kind === "usage") {
    const today = dayKey(dayOf(ctx.now()));
    await ctx.store.put(today, usd(((await ctx.store.get<number>(today)) ?? 0) + amount));
  }
}

/** Gives back a usage charge whose request Telnyx refused outright. */
export async function refund(ctx: Ctx, amount: number): Promise<void> {
  const ledger = await monthLedger(ctx);
  ledger.usage_usd = usd(Math.max(0, ledger.usage_usd - amount));
  await putMonth(ctx, ledger);
  const today = dayKey(dayOf(ctx.now()));
  await ctx.store.put(today, usd(Math.max(0, ((await ctx.store.get<number>(today)) ?? 0) - amount)));
}

export async function noteHeld(ctx: Ctx, held: number, callerNameNumbers: number): Promise<void> {
  const ledger = await monthLedger(ctx);
  if (held <= ledger.peak_numbers && callerNameNumbers <= ledger.caller_name_numbers) return;
  ledger.peak_numbers = Math.max(ledger.peak_numbers, held);
  ledger.caller_name_numbers = Math.max(ledger.caller_name_numbers, callerNameNumbers);
  await putMonth(ctx, ledger);
}

export async function reconcile(ctx: Ctx, month: string, actualUsd: number): Promise<MonthLedger> {
  const ledger = await monthLedger(ctx, month);
  ledger.reconciled_usd = usd(Math.max(ledger.reconciled_usd, actualUsd));
  await ctx.store.put(monthKey(month), ledger);
  return ledger;
}

function daysInMonth(now: number): number {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** The tier from a month's ledger and today's spend, as a pure reading. */
export function tierOf(ledger: MonthLedger, todayUsd: number, now: number): TierReading {
  const rentals = usd(
    ledger.peak_numbers * COST_USD.numberRental + ledger.caller_name_numbers * COST_USD.callerNameLookup,
  );
  const reserve = rentals;
  const budget = usd(MONTHLY_CAP_USD - rentals - reserve - ledger.one_time_usd);
  const monthToDate = usd(Math.max(ledger.usage_usd, ledger.reconciled_usd));
  const daysLeft = daysInMonth(now) - new Date(now).getUTCDate() + 1;
  const allowance = usd(Math.max(0, (budget - (monthToDate - todayUsd)) / daysLeft));

  let tier: Tier = "green";
  if (monthToDate >= budget) tier = "red";
  else if (todayUsd >= allowance || monthToDate >= AMBER_SHARE * budget) tier = "amber";

  return {
    tier,
    month: monthOf(now),
    usage_budget_usd: budget,
    month_to_date_usd: monthToDate,
    today_usd: todayUsd,
    daily_allowance_usd: allowance,
    rentals_usd: rentals,
    next_month_reserve_usd: reserve,
  };
}

export async function readTier(ctx: Ctx): Promise<TierReading> {
  const ledger = await monthLedger(ctx);
  const today = (await ctx.store.get<number>(dayKey(dayOf(ctx.now())))) ?? 0;
  return tierOf(ledger, today, ctx.now());
}
