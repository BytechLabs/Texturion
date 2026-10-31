import { LEG_REGISTRY_TTL_MS, type LegRegistration } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { LIVE_LEG_HORIZON_MS } from "../limits";

/**
 * The leg registry (docs/RIG.md). A command
 * is forwarded only for a call id in here: one the guard dialled itself, or
 * one the edge relayed an event for on a nonprod connection. Production's
 * calls are never registered, so the rig cannot command them.
 */
export interface LegEntry {
  call_control_id: string;
  connection_id: string;
  via: LegRegistration["via"];
  registered_at: number;
  expires_at: number;
  /** Set when the guard forwarded a hangup or reject, or Telnyx said it ended. */
  ended_at?: number;
}

export const LEG_PREFIX = "leg:";

export async function registerLeg(ctx: Ctx, leg: LegRegistration): Promise<LegEntry> {
  const key = `${LEG_PREFIX}${leg.call_control_id}`;
  const existing = await ctx.store.get<LegEntry>(key);
  const now = ctx.now();
  // A re-registration extends the entry but never moves it to another
  // connection: the first nonprod connection seen is the one it stays on.
  const entry: LegEntry = existing && existing.expires_at > now
    ? { ...existing, expires_at: now + LEG_REGISTRY_TTL_MS }
    : {
        call_control_id: leg.call_control_id,
        connection_id: leg.connection_id,
        via: leg.via,
        registered_at: now,
        expires_at: now + LEG_REGISTRY_TTL_MS,
      };
  await ctx.store.put(key, entry);
  return entry;
}

/** The entry for a call id, unless it has expired. */
export async function liveLeg(ctx: Ctx, callControlId: string): Promise<LegEntry | null> {
  const entry = await ctx.store.get<LegEntry>(`${LEG_PREFIX}${callControlId}`);
  if (!entry || entry.expires_at <= ctx.now()) return null;
  return entry;
}

export async function markEnded(ctx: Ctx, callControlId: string): Promise<void> {
  const key = `${LEG_PREFIX}${callControlId}`;
  const entry = await ctx.store.get<LegEntry>(key);
  if (entry && !entry.ended_at) await ctx.store.put(key, { ...entry, ended_at: ctx.now() });
}

export async function pruneLegs(ctx: Ctx): Promise<number> {
  let pruned = 0;
  for (const [key, entry] of await ctx.store.list<LegEntry>(LEG_PREFIX)) {
    if (entry.expires_at <= ctx.now()) {
      await ctx.store.delete(key);
      pruned += 1;
    }
  }
  return pruned;
}

/** Legs registered recently and not known to have ended. */
export async function candidateLiveLegs(ctx: Ctx): Promise<LegEntry[]> {
  const out: LegEntry[] = [];
  for (const entry of (await ctx.store.list<LegEntry>(LEG_PREFIX)).values()) {
    if (entry.ended_at || entry.expires_at <= ctx.now()) continue;
    if (ctx.now() - entry.registered_at > LIVE_LEG_HORIZON_MS) continue;
    out.push(entry);
  }
  return out;
}

/**
 * The nonprod legs alive right now, asking Telnyx about each candidate. A
 * leg Telnyx cannot answer for counts as alive: the count only ever errs
 * toward less room.
 */
export async function liveLegCount(ctx: Ctx): Promise<number> {
  let live = 0;
  for (const entry of await candidateLiveLegs(ctx)) {
    if (!ctx.telnyx) {
      live += 1;
      continue;
    }
    const reply = await ctx.telnyx.send("GET", `/v2/calls/${encodeURIComponent(entry.call_control_id)}`);
    const alive = (reply.body as { data?: { is_alive?: unknown } } | undefined)?.data?.is_alive;
    if ((reply.status === 200 && alive === false) || reply.status === 404) {
      await markEnded(ctx, entry.call_control_id);
    } else {
      live += 1;
    }
  }
  return live;
}
