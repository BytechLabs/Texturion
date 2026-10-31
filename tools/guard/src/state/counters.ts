import type { Ctx } from "../context";

/** UTC periods, as the keys counters are filed under. */
export function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function hourOf(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}

export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

const PREFIX = "count:";

function key(name: string, period: string): string {
  return `${PREFIX}${name}:${period}`;
}

export async function counted(ctx: Ctx, name: string, period: string): Promise<number> {
  return (await ctx.store.get<number>(key(name, period))) ?? 0;
}

/**
 * Takes `amount` from a counter when it still fits under `limit`, and says
 * whether it did. The take happens before the vendor call it pays for, so two
 * requests interleaving across that call cannot both fit into the last slot.
 */
export async function tryTake(
  ctx: Ctx,
  name: string,
  period: string,
  amount: number,
  limit: number,
): Promise<boolean> {
  const current = await counted(ctx, name, period);
  if (current + amount > limit) return false;
  await ctx.store.put(key(name, period), current + amount);
  return true;
}

/** Gives back a take whose vendor call definitely did not happen. */
export async function giveBack(ctx: Ctx, name: string, period: string, amount: number): Promise<void> {
  const current = await counted(ctx, name, period);
  await ctx.store.put(key(name, period), Math.max(0, current - amount));
}

/** Adds without a limit, for counts that are measured rather than capped. */
export async function add(ctx: Ctx, name: string, period: string, amount: number): Promise<number> {
  const next = (await counted(ctx, name, period)) + amount;
  await ctx.store.put(key(name, period), next);
  return next;
}
