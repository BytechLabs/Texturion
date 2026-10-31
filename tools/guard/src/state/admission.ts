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
 * database credential exists here). They are filed through /admin, whose
 * token lives only in the `guard` environment, by guard.yml's `measurements`
 * routine with the values a production reader dispatched it with. Each goes
 * stale, and a stale input admits nothing rather than guessing.
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
    const production = await productionCalls(ctx, view);
    if (production === "live") throw new Refusal("admission.production_call_live");
    if (production === "unknown") throw new Refusal("admission.production_calls_unknown");
  }
}
