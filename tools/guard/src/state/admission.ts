import type { Ctx } from "../context";
import {
  CORE_SCENARIOS,
  MAX_ABANDONED_SHARE,
  MAX_SHORT_SHARE,
  RATIOS_STALE_MS,
  RESERVE_STALE_MS,
  WINDOW_DEFAULT_START_HOUR,
  WINDOW_HOURS,
  WINDOW_STALE_MS,
} from "../limits";
import { Refusal } from "../refusal";
import type { PartitionView } from "../telnyx/partition";
import { requireAboveFloor } from "./balance";
import { readTier } from "./ledger";
import { liveLegCount } from "./legs";
import { requirePaidLanesOpen } from "./signals";

/**
 * Admission for paid dials (docs/RIG.md): a test
 * call never takes the capacity a customer's call needs.
 *
 * Production's reserve, the measured window and the account's ratios come
 * from production's own records, which the guard cannot read (no production
 * database credential exists here). `rigd` files them through /admin from
 * `agent_diag` and detail-record reads; each goes stale, and a stale input
 * admits nothing rather than guessing.
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

export const ADMISSION_KEYS = {
  reserve: "admission:reserve",
  ratios: "admission:ratios",
  window: "admission:window",
} as const;

/** The window's first UTC hour: the measured one while fresh, else 04:00. */
export function windowStartHour(record: WindowRecord | undefined, now: number): number {
  if (record && now - record.measured_at <= WINDOW_STALE_MS) return record.start_hour;
  return WINDOW_DEFAULT_START_HOUR;
}

export function inWindow(now: number, startHour: number): boolean {
  const hour = new Date(now).getUTCHours();
  return (hour - startHour + 24) % 24 < WINDOW_HOURS;
}

/** Room for test legs: the account's limit minus production's reserve, or null when unknown. */
export function roomFor(limit: number | null, reserve: ReserveRecord | undefined, now: number): number | null {
  if (limit === null || !reserve || now - reserve.measured_at > RESERVE_STALE_MS) return null;
  return Math.max(0, limit - reserve.legs);
}

export function ratioRule(ratios: RatiosRecord | undefined, now: number): Refusal | null {
  if (!ratios || now - ratios.measured_at > RATIOS_STALE_MS) return new Refusal("admission.ratios_unknown");
  if (ratios.calls <= 0) return null;
  if (ratios.abandoned / ratios.calls > MAX_ABANDONED_SHARE) return new Refusal("admission.abandoned_ratio");
  if (ratios.short / ratios.calls > MAX_SHORT_SHARE) return new Refusal("admission.short_ratio");
  return null;
}

/**
 * True when production has a call up right now, on any of its connections.
 * Null when Telnyx would not say: the active-calls API is unverified for this
 * account, and its absence leaves the room formula as the only protection.
 */
export async function productionCallLive(ctx: Ctx, view: PartitionView): Promise<boolean | null> {
  if (!ctx.telnyx) return null;
  let answered = false;
  for (const id of view.record.production.connection_ids) {
    const reply = await ctx.telnyx.send("GET", `/v2/connections/${encodeURIComponent(id)}/active_calls`);
    if (reply.status !== 200) continue;
    answered = true;
    const data = (reply.body as { data?: unknown[] } | undefined)?.data;
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return answered ? false : null;
}

export interface PaidRequest {
  /** Legs this request adds: 1 for a dial or transfer, 0 for a bridge. */
  newLegs: number;
  scenario: string | null;
}

/** Every admission rule, cheapest first. Throws the first {@link Refusal} that applies. */
export async function admitPaid(ctx: Ctx, view: PartitionView, request: PaidRequest): Promise<void> {
  await requirePaidLanesOpen(ctx);
  const now = ctx.now();
  if (ctx.config.concurrentLimit === null) throw new Refusal("admission.limit_unknown");

  const window = await ctx.store.get<WindowRecord>(ADMISSION_KEYS.window);
  if (!inWindow(now, windowStartHour(window, now))) throw new Refusal("admission.outside_window");

  const ratio = ratioRule(await ctx.store.get<RatiosRecord>(ADMISSION_KEYS.ratios), now);
  if (ratio) throw ratio;

  const room = roomFor(ctx.config.concurrentLimit, await ctx.store.get<ReserveRecord>(ADMISSION_KEYS.reserve), now);
  if (room === null) throw new Refusal("admission.reserve_unknown");

  const tier = await readTier(ctx);
  if (tier.tier === "red") throw new Refusal("budget.tier_red");
  if (tier.tier === "amber" && !(request.scenario && CORE_SCENARIOS.includes(request.scenario))) {
    throw new Refusal("budget.tier_amber");
  }
  await requireAboveFloor(ctx);

  if (request.newLegs > 0) {
    if ((await liveLegCount(ctx)) + request.newLegs > room) throw new Refusal("admission.no_room");
    if ((await productionCallLive(ctx, view)) === true) throw new Refusal("admission.production_call_live");
  }
}
