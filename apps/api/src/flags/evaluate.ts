/**
 * #283 — reading flags at runtime, cheaply, and never fatally.
 *
 * THE REQUIREMENT IS RUNTIME EVALUATION. A flag that needs a deploy to flip is
 * a constant with extra steps — the issue's words, and the whole reason
 * `BILLING_WRITES_DISABLED` (an env var, set at deploy time) was never the
 * answer.
 *
 * TWO PROPERTIES, and they pull against each other:
 *
 *   FAST. A database round trip on every request to ask "is calls on?" would
 *   put the flag store on the hot path of everything. So flags are cached in
 *   the isolate for TTL_MS, which bounds staleness at "a few seconds" — inside
 *   the "contained in seconds" the issue asks of a kill switch, and far below
 *   the minutes a deploy takes.
 *
 *   HARMLESS WHEN BROKEN. Every failure — unreachable store, malformed row,
 *   missing key — resolves to the default declared in `registry.ts`. A kill
 *   switch defaults ON, so a database outage cannot disable the product. This
 *   is the property that makes a flag system worth having: without it, the
 *   flags become one more shared dependency with the same total blast radius
 *   they exist to shrink.
 *
 * PER-COMPANY CACHING. The cache is keyed by company because overrides and
 * percentage buckets are per-company. A global-only cache would leak one
 * workspace's rollout to the next request from another.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { flagDefault, type FlagKey } from "./registry";

/**
 * How long a cached evaluation is trusted.
 *
 * Ten seconds. Short enough that flipping a kill switch takes effect while
 * somebody is still watching the graph, long enough that a burst of requests
 * from one workspace costs one read. The cost of staleness here is bounded and
 * small in both directions: ten more seconds of a broken feature, or ten more
 * seconds without a new one.
 */
const TTL_MS = 10_000;

interface CacheEntry {
  values: Record<string, boolean>;
  expiresAt: number;
}

/**
 * Isolate-local. Cloudflare gives each isolate its own copy and recycles them
 * freely, which is exactly the behaviour wanted: no invalidation protocol, and
 * a cold isolate simply reads once.
 */
const cache = new Map<string, CacheEntry>();

/** Test seam: a fresh isolate is the production reset, and tests need one too. */
export function resetFlagCache(): void {
  cache.clear();
}

/**
 * Every flag the store has something to say about, for one company.
 *
 * Returns `{}` on any failure, which resolves every key to its code default.
 * Logged, never thrown: a caller asking "is this feature on?" must always get
 * an answer, and the honest answer when we cannot ask is "whatever the code
 * says normally".
 */
async function loadFlags(
  env: Env,
  companyId: string | null,
  db?: SupabaseClient,
  now = Date.now(),
): Promise<Record<string, boolean>> {
  const cacheKey = companyId ?? "__global__";
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.values;

  try {
    const client = db ?? getDb(env);
    const { data, error } = await client.rpc("api_evaluate_flags", {
      p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    const values = (data ?? {}) as Record<string, boolean>;
    cache.set(cacheKey, { values, expiresAt: now + TTL_MS });
    return values;
  } catch (cause) {
    console.error(`flags: evaluation failed, falling back to defaults: ${String(cause)}`);
    // Cache the empty answer too, briefly. Otherwise an outage in the flag
    // store turns into a retry storm against the same unhealthy database from
    // every request in flight.
    cache.set(cacheKey, { values: {}, expiresAt: now + TTL_MS });
    return {};
  }
}

/**
 * Is this feature on for this workspace?
 *
 * `companyId` may be null for a path with no workspace in hand (a webhook, a
 * cron). Those get the global answer, and a percentage rollout reads as off
 * for them — a rollout is a statement about a cohort, and a request with no
 * company is not in any cohort.
 */
export async function isFlagOn(
  env: Env,
  key: FlagKey,
  companyId: string | null = null,
  db?: SupabaseClient,
): Promise<boolean> {
  const values = await loadFlags(env, companyId, db);
  const value = values[key];
  return typeof value === "boolean" ? value : flagDefault(key);
}

/**
 * The inverse, for the four kill switches, because `if (!(await isFlagOn(...)))`
 * reads backwards at every call site and a kill switch is read in exactly one
 * shape: "is this subsystem switched off?".
 */
export async function isKilled(
  env: Env,
  key: FlagKey,
  companyId: string | null = null,
  db?: SupabaseClient,
): Promise<boolean> {
  return !(await isFlagOn(env, key, companyId, db));
}
