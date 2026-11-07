import type { Ctx } from "../context";
import { BALANCE_CACHE_MS, BALANCE_FLOOR_DAYS, BALANCE_FLOOR_MIN_USD } from "../limits";
import { Refusal } from "../refusal";
import type { TelnyxReply } from "../telnyx/client";
import { dayOf } from "./counters";

/**
 * The account's prepaid balance, which production and the rig share
 * (docs/RIG.md). Below the floor, the larger of $30 and 14 days
 * of the account's spend, no test spend is admitted at all.
 */
interface BalanceReading {
  usd: number;
  read_at: number;
}

interface Sample {
  day: string;
  usd: number;
}

const KEYS = {
  reading: "balance:reading",
  samples: "balance:samples",
} as const;

const KEEP_SAMPLES = 15;

/**
 * The account's average daily spend over the samples held, counting only the
 * days the balance fell: a top-up is not negative spend. All of it is
 * treated as production's, which only raises the floor.
 */
export function averageDailySpend(samples: readonly Sample[]): number | null {
  if (samples.length < 2) return null;
  let spent = 0;
  for (let i = 1; i < samples.length; i++) spent += Math.max(0, samples[i - 1].usd - samples[i].usd);
  return spent / (samples.length - 1);
}

export function floorFor(samples: readonly Sample[]): number {
  const daily = averageDailySpend(samples) ?? 0;
  return Math.max(BALANCE_FLOOR_MIN_USD, daily * BALANCE_FLOOR_DAYS);
}

/**
 * Telnyx itself refused the account's own read: how a disabled account
 * answers. The edge corroborates a notice by this, so the route passes it on
 * as Telnyx's answer rather than as a guard refusal.
 */
export class AccountRefused extends Error {
  constructor(readonly reply: TelnyxReply) {
    super(`Telnyx refused the balance read with ${reply.status}`);
    this.name = "AccountRefused";
  }
}

/** The balance as a number, at most {@link BALANCE_CACHE_MS} old. */
export async function readBalance(ctx: Ctx, options: { fresh?: boolean } = {}): Promise<number> {
  const cached = await ctx.store.get<BalanceReading>(KEYS.reading);
  if (!options.fresh && cached && ctx.now() - cached.read_at < BALANCE_CACHE_MS) return cached.usd;
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  const reply = await ctx.telnyx.send("GET", "/v2/balance");
  if (reply.status === 401 || reply.status === 403) throw new AccountRefused(reply);
  const raw = (reply.body as { data?: { balance?: unknown } } | undefined)?.data?.balance;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (reply.status !== 200 || !Number.isFinite(value)) throw new Refusal("budget.balance_unknown");

  await ctx.store.put(KEYS.reading, { usd: value, read_at: ctx.now() } satisfies BalanceReading);
  const samples = (await ctx.store.get<Sample[]>(KEYS.samples)) ?? [];
  const today = dayOf(ctx.now());
  if (samples.at(-1)?.day !== today) {
    samples.push({ day: today, usd: value });
    await ctx.store.put(KEYS.samples, samples.slice(-KEEP_SAMPLES));
  }
  return value;
}

export async function balanceFloor(ctx: Ctx): Promise<number> {
  return floorFor((await ctx.store.get<Sample[]>(KEYS.samples)) ?? []);
}

/** Refuses when the balance is unreadable or under the floor. */
export async function requireAboveFloor(ctx: Ctx): Promise<void> {
  let balance: number;
  try {
    balance = await readBalance(ctx);
  } catch (cause) {
    if (cause instanceof AccountRefused) throw new Refusal("budget.balance_unknown");
    throw cause;
  }
  if (balance < (await balanceFloor(ctx))) throw new Refusal("budget.balance_floor");
}

/** For /health: whether test spend would pass the floor right now. */
export async function balanceAboveFloor(ctx: Ctx): Promise<{ balance: number | null; above: boolean }> {
  try {
    const balance = await readBalance(ctx);
    return { balance, above: balance >= (await balanceFloor(ctx)) };
  } catch {
    return { balance: null, above: false };
  }
}
