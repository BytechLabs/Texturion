/**
 * The guard, reached through the edge with the rig's `rig-api` caller token.
 * Paths come from the shared wire contract, never spelled here.
 */
import { EDGE_PATHS, GUARD_ROUTES, HEADER } from "../../rig-protocol/src/index.ts";

/**
 * Standing numbers by role. The partition lists the owned numbers; which one
 * is which comes from `partition.standing` when the guard sends it, and from
 * the store's standing-numbers.json until then. Either way each must be in the
 * live listing, so a stale file cannot name a number the rig no longer owns.
 */
export const STANDING_ROLES = [
  "ROBOT-1",
  "ROBOT-2",
  "STRANGER-1",
  "DEV-W1",
  "DEV-W2",
  "DEV-A1",
  "DEV-C1",
  "DEV-E1",
];

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** https, or http on loopback for a stub guard on a workstation. */
export function edgeOrigin(store) {
  const origin = store.read("edge-origin").replace(/\/+$/, "");
  const url = new URL(origin);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.pathname !== "/" || url.search) {
    throw new Error("rig: edge-origin must be a bare https origin");
  }
  return url.origin;
}

export function guardUrl(edge, route) {
  return `${edge}${EDGE_PATHS.guardPrefix}${route}`;
}

export async function guardGet(store, route, fetchImpl = fetch) {
  const response = await fetchImpl(guardUrl(edgeOrigin(store), route), {
    headers: { authorization: `Bearer ${store.read("guard-token-rig-api")}` },
  });
  if (!response.ok) {
    const refusedBy = response.headers.get(HEADER.refusedBy);
    throw new Error(`rig: guard ${route} answered ${response.status}${refusedBy ? ` (refused by ${refusedBy})` : ""}`);
  }
  return response.json();
}

export function fetchPartition(store, fetchImpl) {
  return guardGet(store, GUARD_ROUTES.partition, fetchImpl);
}

/**
 * Every standing role with its number, Telnyx id and messaging profile,
 * checked against the live partition.
 *
 * @returns {Map<string, { role: string, e164: string, telnyx_phone_number_id: string | null, messaging_profile_id: string | null }>}
 */
export function standingNumbers(partition, store) {
  const entries = partition.standing ?? store.readOptional("standing-numbers.json");
  if (entries === undefined) {
    throw new Error(
      "rig: the partition names no roles and the store has no standing-numbers.json, so " +
        "STRANGER-1 cannot be told apart from the numbers the app may use",
    );
  }
  const list = typeof entries === "string" ? JSON.parse(entries) : entries;
  const owned = new Set(partition.owned_e164 ?? []);
  const profiles = new Set(partition.messaging_profile_ids ?? []);
  const byRole = new Map();
  for (const entry of list) {
    if (!STANDING_ROLES.includes(entry.role)) throw new Error(`rig: unknown standing role ${entry.role}`);
    if (byRole.has(entry.role)) throw new Error(`rig: standing role ${entry.role} is listed twice`);
    if (!E164.test(entry.e164 ?? "")) throw new Error(`rig: ${entry.role} is not E.164`);
    if (!owned.has(entry.e164)) throw new Error(`rig: ${entry.role} is not in the guard's live listing`);
    const profile = entry.messaging_profile_id ?? null;
    if (profile !== null && !profiles.has(profile)) {
      throw new Error(`rig: ${entry.role}'s messaging profile is not a nonprod profile`);
    }
    byRole.set(entry.role, {
      role: entry.role,
      e164: entry.e164,
      telnyx_phone_number_id: entry.telnyx_phone_number_id ?? null,
      messaging_profile_id: profile,
    });
  }
  const missing = STANDING_ROLES.filter((role) => !byRole.has(role));
  if (missing.length > 0) throw new Error(`rig: no number for ${missing.join(", ")}`);
  return byRole;
}

/**
 * RIG_OWNED_E164 and loonext.rig_endpoints: every owned number except
 * STRANGER-1, which G01 uses to prove the app turns strangers away.
 */
export function rigEndpoints(partition, standing) {
  const stranger = standing.get("STRANGER-1").e164;
  const endpoints = [...new Set(partition.owned_e164)].filter((e164) => e164 !== stranger).sort();
  for (const e164 of endpoints) if (!E164.test(e164)) throw new Error("rig: the partition lists a number that is not E.164");
  return endpoints;
}
