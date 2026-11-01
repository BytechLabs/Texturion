import type { Ctx } from "../context";
import { LIMIT_EVIDENCE_STALE_MS, PAID_CONCURRENT } from "../limits";
import { sendProductionEvent } from "../sentry";

/**
 * The account's concurrent call limit, as the guard can prove it (docs/RIG.md,
 * D142 update of 2026-11-01). No API reports the limit, so it is never taken
 * on anyone's word:
 *   - the floor, TELNYX_CONCURRENT_FLOOR, the lowest documented default. While
 *     only the floor is in force, admission adds no leg at all;
 *   - validation: the limit-probe profile's concurrent_call_limit, which
 *     Telnyx says must be no more than the account's, searched to the largest
 *     value it accepts (setup/limit-probe.ts). It is the only evidence that
 *     raises the limit above the floor, and only as far as Paid's
 *     PAID_CONCURRENT, or the history bound when that is higher: Telnyx does
 *     not say the boundary is the account's limit rather than a product
 *     maximum;
 *   - history: the most production calls that overlapped in 28 days. The
 *     account carried that many at once, so its limit is at least that. It
 *     checks the validation and never opens room by itself;
 *   - ceilings: a Telnyx refusal for concurrency, and the robot hearing the
 *     announcement only Paid accounts and below get. They only ever lower it.
 * Evidence that contradicts itself is a conflict, and admits nothing.
 */
export interface ValidationRecord {
  /** `exact`: V accepted and V+1 refused; `not_enforced`: the absurd value was accepted. */
  result: "exact" | "not_enforced" | "inconclusive";
  value: number | null;
  measured_at: number;
  writes: number;
  /** Telnyx's error code on the identified refusal, never its words. */
  refusal_code: string | null;
  /** Each write's answer in order, so an inconclusive run can be read afterwards. */
  trace?: ProbeWrite[];
}

/** One write of the validation check: what was asked and the kind of answer, with Telnyx's code and field but never its words. */
export interface ProbeWrite {
  value: number;
  /** HTTP status, or 0 when the request did not complete. */
  status: number;
  code: string | null;
  pointer: string | null;
}

export interface HistoryRecord {
  peak_calls: number;
  measured_at: number;
}

export interface Ceiling {
  /** Null when the refusal says the limit was hit but not at what count. */
  value: number | null;
  /** `telnyx-90041`, `telnyx-90103`, `level:paid_or_below`. */
  from: string;
  at: number;
}

export type LimitSource = "floor" | "validation";

export interface LimitInForce {
  /** Null only when the floor itself is unparseable. */
  limit: number | null;
  source: LimitSource;
  floor: number | null;
  validation: ValidationRecord | null;
  /** The fresh history lower bound, or null. */
  history: number | null;
  /** The lowest fresh valued ceiling, else the newest value-less one. */
  ceiling: Ceiling | null;
  /** Why the evidence contradicts itself, or null. */
  conflict: string | null;
}

export const LIMIT_KEYS = {
  validation: "limit:validation",
  history: "limit:history",
  ceiling: "limit:ceiling",
  /** When the validation check last ran, conclusive or not, for its once-a-day pace. */
  probe: "limit:probe",
  conflictAlert: "limit:conflict-alert",
  /** The validated value last alerted on for being above what the rig can corroborate. */
  cappedAlert: "limit:capped-alert",
} as const;

const MAX_CEILINGS = 20;

function fresh(at: number, now: number): boolean {
  return now - at <= LIMIT_EVIDENCE_STALE_MS;
}

async function freshCeilings(ctx: Ctx): Promise<Ceiling[]> {
  const now = ctx.now();
  return ((await ctx.store.get<Ceiling[]>(LIMIT_KEYS.ceiling)) ?? []).filter((item) => fresh(item.at, now));
}

export async function recordCeiling(ctx: Ctx, ceiling: Omit<Ceiling, "at">): Promise<void> {
  const kept = await freshCeilings(ctx);
  await ctx.store.put(LIMIT_KEYS.ceiling, [...kept, { ...ceiling, at: ctx.now() }].slice(-MAX_CEILINGS));
}

/** The robot heard Telnyx's automated-call announcement: the account is at Paid or below. */
export async function recordLevelEvidence(ctx: Ctx): Promise<void> {
  await recordCeiling(ctx, { value: PAID_CONCURRENT, from: "level:paid_or_below" });
}

export async function limitInForce(ctx: Ctx): Promise<LimitInForce> {
  const now = ctx.now();
  const floor = ctx.config.concurrentFloor;
  const stored = (await ctx.store.get<ValidationRecord>(LIMIT_KEYS.validation)) ?? null;
  const historyRecord = await ctx.store.get<HistoryRecord>(LIMIT_KEYS.history);
  const history = historyRecord && fresh(historyRecord.measured_at, now) ? historyRecord.peak_calls : null;
  const ceilings = await freshCeilings(ctx);
  const valued = ceilings.filter((item): item is Ceiling & { value: number } => item.value !== null);
  const lowest = valued.reduce<(Ceiling & { value: number }) | null>(
    (low, item) => (low === null || item.value < low.value ? item : low),
    null,
  );
  const ceiling = lowest ?? ceilings.at(-1) ?? null;
  const cap = (value: number) => (lowest ? Math.min(value, lowest.value) : value);

  const exact = stored?.result === "exact" && stored.value !== null && fresh(stored.measured_at, now) ? stored.value : null;
  let limit: number | null;
  let source: LimitSource;
  if (floor === null) {
    limit = null;
    source = "floor";
  } else if (exact !== null) {
    limit = cap(Math.min(exact, Math.max(PAID_CONCURRENT, history ?? 0)));
    source = "validation";
  } else {
    limit = cap(floor);
    source = "floor";
  }

  let conflict: string | null = null;
  if (lowest && history !== null && history > lowest.value) conflict = "history_above_ceiling";
  else if (lowest && floor !== null && floor > lowest.value) conflict = "floor_above_ceiling";
  else if (exact !== null && history !== null && exact < history) conflict = "validation_below_history";

  const result: LimitInForce = { limit, source, floor, validation: stored, history, ceiling, conflict };
  await alertConflictOnce(ctx, conflict);
  await alertCappedOnce(ctx, exact !== null && exact > Math.max(PAID_CONCURRENT, history ?? 0) ? exact : null);
  return result;
}

/** One warning per validated value above what Paid's limit or production's history supports. */
async function alertCappedOnce(ctx: Ctx, value: number | null): Promise<void> {
  const alerted = await ctx.store.get<number>(LIMIT_KEYS.cappedAlert);
  if (value === null || alerted === value) return;
  await ctx.store.put(LIMIT_KEYS.cappedAlert, value);
  await sendProductionEvent(ctx, {
    key: "telnyx-guard-limit-capped",
    summary: "The rig's validation check found a concurrent limit above what it can corroborate",
    detail:
      `The check accepted ${value}, above Paid's ${PAID_CONCURRENT} and production's measured peak, so the guard ` +
      `counts no more than the higher of those two. A boundary that high may be a product maximum, not the account's limit.`,
    level: "warning",
  });
}

/** One production alert per conflict, raised again only once it has cleared and come back. */
async function alertConflictOnce(ctx: Ctx, conflict: string | null): Promise<void> {
  const alerted = await ctx.store.get<string>(LIMIT_KEYS.conflictAlert);
  if (conflict === null) {
    if (alerted !== undefined) await ctx.store.delete(LIMIT_KEYS.conflictAlert);
    return;
  }
  if (alerted === conflict) return;
  await ctx.store.put(LIMIT_KEYS.conflictAlert, conflict);
  await sendProductionEvent(ctx, {
    key: "telnyx-guard-limit-conflict",
    summary: "The rig's evidence about Telnyx's concurrent call limit contradicts itself",
    detail:
      `The guard found ${conflict.replace(/_/g, " ")} and refuses every paid dial (admission.limit_conflict) ` +
      "until the evidence agrees again or lapses. Production's own calls may be nearer the account's limit than assumed.",
    level: "error",
  });
}

/** Test legs the limit leaves after production's reserve: none while only the floor is proven. */
export function roomUnder(concurrency: LimitInForce, reserveLegs: number): number {
  if (concurrency.limit === null || concurrency.source === "floor" || concurrency.conflict) return 0;
  return Math.max(0, concurrency.limit - reserveLegs);
}
