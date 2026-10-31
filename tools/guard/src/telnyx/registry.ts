import {
  TELNYX_ENDPOINTS,
  type TelnyxEndpoint,
  type TelnyxMethod,
  type TelnyxPolicyClass,
} from "../../../../apps/api/src/telnyx/endpoints";

/**
 * The guard's Telnyx policy table, generated from the app's endpoint registry
 * (apps/api/src/telnyx/endpoints.ts). The registry is the list of every
 * endpoint the app calls, each with a class; scripts/check-telnyx-endpoints.mjs
 * keeps it equal to the app's calls, and test/registry.test.ts fails when an
 * entry has no handler here. So a new endpoint is decided once, in the pull
 * request that adds it, and the guard deployed from that merge enforces it.
 */
export type { TelnyxMethod, TelnyxPolicyClass };

export interface PolicyEntry {
  readonly method: TelnyxMethod;
  readonly path: string;
  readonly policy: TelnyxPolicyClass;
  /** `METHOD /v2/path/:id`, the key class handlers are looked up by. */
  readonly key: string;
  readonly pattern: RegExp;
}

export interface Matched {
  entry: PolicyEntry;
  /** The path's ids, in order, URL-decoded. */
  ids: string[];
}

function compile(endpoint: TelnyxEndpoint): PolicyEntry {
  const source = endpoint.path
    .split("/")
    .map((segment) => (segment === ":id" ? "([^/]+)" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return {
    method: endpoint.method,
    path: endpoint.path,
    policy: endpoint.policy,
    key: `${endpoint.method} ${endpoint.path}`,
    pattern: new RegExp(`^${source}$`),
  };
}

export const POLICY_TABLE: readonly PolicyEntry[] = TELNYX_ENDPOINTS.map(compile);

export function matchEndpoint(method: string, path: string): Matched | null {
  for (const entry of POLICY_TABLE) {
    if (entry.method !== method) continue;
    const found = entry.pattern.exec(path);
    if (found) return { entry, ids: found.slice(1).map((id) => decodeURIComponent(id)) };
  }
  return null;
}

/**
 * True when a path is safe to match and forward: no empty, dot or
 * dot-dot segment, and no encoded separator that Telnyx might decode after the
 * guard matched the path one way.
 */
export function isCleanPath(path: string): boolean {
  if (!path.startsWith("/v2/")) return false;
  if (/%2f|%5c|%2e|\\/i.test(path)) return false;
  const segments = path.split("/").slice(1);
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
