import { LEASE_MAX_MS, type LeaseActivity, type LeaseGrant } from "@loonext/rig-protocol";

import type { GuardCaller } from "../caller";
import type { Ctx } from "../context";
import { Refusal } from "../refusal";

/**
 * The run lease (docs/RIG.md): one paid scenario at a time across
 * the whole system, for at most {@link LEASE_MAX_MS}. The guard only stops
 * honouring an unreleased lease; undoing what the scenario changed is `rigd`'s
 * job.
 */
export interface LeaseRecord extends LeaseGrant {
  holder: GuardCaller;
  acquired_at: number;
  expires_ms: number;
  released_at?: number;
  /** Set when a production call took the line and every test leg was hung up. */
  preempted_at?: number;
  /** What reached the Telnyx route while the lease was live, by {@link activityKey}. */
  activity?: Record<string, number>;
}

const KEY = "lease";

/** Scenario ids as docs/RIG.md writes them: R00, S28, D02p. */
const SCENARIO = /^[A-Z][0-9]{2}[a-z]?$/;

export async function liveLease(ctx: Ctx): Promise<LeaseRecord | null> {
  const lease = await ctx.store.get<LeaseRecord>(KEY);
  if (!lease || lease.released_at || lease.preempted_at || lease.expires_ms <= ctx.now()) return null;
  return lease;
}

export async function acquireLease(ctx: Ctx, scenario: unknown, holder: GuardCaller): Promise<LeaseRecord> {
  if (typeof scenario !== "string" || !SCENARIO.test(scenario)) throw new Refusal("lease.scenario_invalid");
  if (await liveLease(ctx)) throw new Refusal("lease.busy");
  const now = ctx.now();
  const lease: LeaseRecord = {
    lease_id: crypto.randomUUID(),
    scenario,
    expires_at: new Date(now + LEASE_MAX_MS).toISOString(),
    holder,
    acquired_at: now,
    expires_ms: now + LEASE_MAX_MS,
  };
  await ctx.store.put(KEY, lease);
  return lease;
}

export async function releaseLease(ctx: Ctx, leaseId: string): Promise<LeaseRecord> {
  const lease = await ctx.store.get<LeaseRecord>(KEY);
  if (!lease || lease.lease_id !== leaseId || lease.released_at) throw new Refusal("lease.not_found");
  const released = { ...lease, released_at: ctx.now() };
  await ctx.store.put(KEY, released);
  return released;
}

export async function markPreempted(ctx: Ctx, leaseId: string): Promise<void> {
  const lease = await ctx.store.get<LeaseRecord>(KEY);
  if (lease && lease.lease_id === leaseId) await ctx.store.put(KEY, { ...lease, preempted_at: ctx.now() });
}

/**
 * The live lease a dial, transfer or bridge runs under. Test code names it in
 * the lease header. The app under test cannot, since nothing in it knows the
 * lease, so a `rig-api` request without the header runs under whatever lease
 * is live, and there must be one. A header naming another lease is refused
 * for every caller.
 */
export async function requireDialLease(ctx: Ctx, header: string | null, caller: GuardCaller): Promise<LeaseRecord> {
  if (!header && caller !== "rig-api") throw new Refusal("dial.lease_missing");
  const lease = await liveLease(ctx);
  if (!lease || (header && lease.lease_id !== header)) throw new Refusal("dial.lease_not_live");
  return lease;
}

/**
 * `<caller> <METHOD> <registry path> <outcome>`, the outcome being the
 * answer's status or the refusal's rule. It names endpoints, never ids or
 * numbers, so the record says what a run asked for and nothing about whom.
 */
export function activityKey(caller: GuardCaller, endpoint: string, outcome: string | number): string {
  return `${caller} ${endpoint} ${outcome}`;
}

/**
 * Counts one Telnyx request against the live lease. A request while no lease
 * is live belongs to no run, so nothing counts it.
 */
export async function noteActivity(ctx: Ctx, key: string): Promise<void> {
  const lease = await liveLease(ctx);
  if (!lease) return;
  await ctx.store.put(KEY, { ...lease, activity: { ...lease.activity, [key]: (lease.activity?.[key] ?? 0) + 1 } });
}

/** One lease's record, live or released, for as long as it is the last lease acquired. */
export async function leaseActivity(ctx: Ctx, leaseId: string): Promise<LeaseActivity> {
  const lease = await ctx.store.get<LeaseRecord>(KEY);
  if (!lease || lease.lease_id !== leaseId) throw new Refusal("lease.not_found");
  const live = await liveLease(ctx);
  return { ...toGrant(lease), live: live?.lease_id === leaseId, activity: lease.activity ?? {} };
}

export function toGrant(lease: LeaseRecord): LeaseGrant {
  return { lease_id: lease.lease_id, scenario: lease.scenario, expires_at: lease.expires_at };
}
