import {
  type CallerClass,
  type DetachRequest,
  EDGE_CALLER,
  EDGE_ONLY_ROUTES,
  GUARD_ROUTES,
  type HaltRequest,
  HEADER,
  type LegRegistration,
  PARTITION_CACHE_MS,
  type Partition,
} from "@loonext/rig-protocol";

import type { Env } from "./env";
import { json } from "./http";

/** The service binding ignores the host; a fixed one keeps the edge's out of guard logic. */
const GUARD_ORIGIN = "https://guard.internal";

export const GUARD_CALL_TIMEOUT_MS = 3_000;

/** One call of the edge's own. Throws on a network failure or timeout. */
export async function guardCall(
  env: Env,
  method: "GET" | "POST",
  route: string,
  body?: unknown,
  timeoutMs: number = GUARD_CALL_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers({ [HEADER.callerClass]: EDGE_CALLER });
  if (body !== undefined) headers.set("content-type", "application/json");
  return env.GUARD.fetch(`${GUARD_ORIGIN}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** True when the guard answered 2xx; a failure is logged, never thrown. */
export async function guardPost(
  env: Env,
  route: string,
  body: unknown,
  timeoutMs: number = GUARD_CALL_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const response = await guardCall(env, "POST", route, body, timeoutMs);
    if (!response.ok) console.warn(`guard ${route}: ${response.status}`);
    return response.ok;
  } catch (cause) {
    console.warn(`guard ${route}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  }
}

export function registerLeg(env: Env, leg: LegRegistration, timeoutMs?: number): Promise<boolean> {
  return guardPost(env, GUARD_ROUTES.legs, leg, timeoutMs);
}

export function rejectLeg(env: Env, leg: LegRegistration): Promise<boolean> {
  return guardPost(env, GUARD_ROUTES.reject, leg);
}

export function requestDetach(env: Env, body: DetachRequest): Promise<boolean> {
  return guardPost(env, GUARD_ROUTES.detach, body);
}

export function requestHalt(env: Env, body: HaltRequest): Promise<boolean> {
  return guardPost(env, GUARD_ROUTES.halt, body);
}

/** Saves a guard round trip per event; the guard's registry is the record. */
const registeredLegs = new Map<string, number>();
const REGISTERED_LEG_MEMORY_MS = 10 * 60 * 1000;

export async function registerLegOnce(
  env: Env,
  leg: LegRegistration,
  timeoutMs: number = GUARD_CALL_TIMEOUT_MS,
  now = Date.now(),
): Promise<void> {
  const at = registeredLegs.get(leg.call_control_id);
  if (at !== undefined && now - at < REGISTERED_LEG_MEMORY_MS) return;
  if (await registerLeg(env, leg, timeoutMs)) {
    if (registeredLegs.size > 5_000) registeredLegs.clear();
    registeredLegs.set(leg.call_control_id, now);
  }
}

/** A cached partition older than this is not used even when the guard is down. */
const PARTITION_STALE_MAX_MS = 60 * 60 * 1000;
/** Telnyx wants a messaging 2xx within 2 seconds, so a cold fetch gets less. */
const PARTITION_TIMEOUT_MS = 1_500;

let cachedPartition: { partition: Partition; fetchedAt: number } | null = null;

function isPartition(value: unknown): value is Partition {
  const p = value as Partition | null;
  const strings = (list: unknown) => Array.isArray(list) && list.every((x) => typeof x === "string");
  return (
    p !== null &&
    typeof p === "object" &&
    strings(p.owned_e164) &&
    strings(p.standing_e164) &&
    strings(p.messaging_profile_ids) &&
    p.connection_ids !== null &&
    typeof p.connection_ids === "object" &&
    // An empty id is a connection not created yet; no event can match it.
    (["voice", "robot", "webrtc", "sentinel"] as const).every((role) => typeof p.connection_ids[role] === "string")
  );
}

async function fetchPartition(env: Env): Promise<Partition | null> {
  try {
    const response = await guardCall(env, "GET", GUARD_ROUTES.partition, undefined, PARTITION_TIMEOUT_MS);
    if (!response.ok) {
      console.warn(`guard partition: ${response.status}`);
      return null;
    }
    const body: unknown = await response.json();
    return isPartition(body) ? body : null;
  } catch (cause) {
    console.warn(`guard partition: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

/**
 * The guard's live partition, cached for {@link PARTITION_CACHE_MS}. When the
 * guard cannot answer, a copy up to an hour old still decides ownership;
 * older than that, null, and the caller fails closed.
 */
export async function partitionFor(env: Env, now: number = Date.now()): Promise<Partition | null> {
  if (cachedPartition && now - cachedPartition.fetchedAt < PARTITION_CACHE_MS) {
    return cachedPartition.partition;
  }
  // Not shared between concurrent requests: workerd ties a promise to the
  // request that made it, so one request awaiting another's fetch can hang.
  const fresh = await fetchPartition(env);
  if (fresh) {
    cachedPartition = { partition: fresh, fetchedAt: now };
    return fresh;
  }
  if (cachedPartition && now - cachedPartition.fetchedAt < PARTITION_STALE_MAX_MS) {
    return cachedPartition.partition;
  }
  return null;
}

/** Forget the isolate's caches. Suites call this between cases. */
export function resetGuardCaches(): void {
  cachedPartition = null;
  registeredLegs.clear();
}

/**
 * The only `x-rig-*` headers a caller may send: its own claims, which the
 * guard checks. Any other is removed, so a caller cannot speak for the edge.
 */
const CALLER_RIG_HEADERS = new Set<string>([HEADER.lease, HEADER.scenario]);

/**
 * Compared in every spelling a router might fold together: case, repeated
 * slashes and percent-encoding. An undecodable route is treated as edge-only.
 */
export function isEdgeOnly(route: string): boolean {
  let folded: string;
  try {
    folded = decodeURIComponent(route).toLowerCase().replace(/\/{2,}/g, "/");
  } catch {
    return true;
  }
  return EDGE_ONLY_ROUTES.some((only) => folded === only || folded.startsWith(`${only}/`));
}

/** The guard never sees a caller's bearer token: the class stands in for it. */
export async function forwardToGuard(
  env: Env,
  request: Request,
  route: string,
  callerClass: CallerClass,
): Promise<Response> {
  if (isEdgeOnly(route)) {
    const refused = json(403, { error: "guard_refused", rule: "route.edge_only" });
    refused.headers.set(HEADER.refusedBy, EDGE_CALLER);
    return refused;
  }
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "cookie") continue;
    if (lower.startsWith("x-rig-") && !CALLER_RIG_HEADERS.has(lower)) continue;
    headers.set(name, value);
  }
  headers.set(HEADER.callerClass, callerClass);

  const url = new URL(request.url);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return env.GUARD.fetch(`${GUARD_ORIGIN}${route}${url.search}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });
}
