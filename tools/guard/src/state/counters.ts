import type { Ctx } from "../context";

/** UTC periods, as the keys counters are filed under. */
export function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const PREFIX = "count:";

function key(name: string, period: string): string {
  return `${PREFIX}${name}:${period}`;
}

export async function counted(ctx: Ctx, name: string, period: string): Promise<number> {
  return (await ctx.store.get<number>(key(name, period))) ?? 0;
}

/** Adds without a limit, for counts that are measured rather than capped. */
export async function add(ctx: Ctx, name: string, period: string, amount: number): Promise<number> {
  const next = (await counted(ctx, name, period)) + amount;
  await ctx.store.put(key(name, period), next);
  return next;
}
