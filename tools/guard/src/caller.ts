import { CALLER_CLASSES, GUARD_ROUTES, type CallerClass } from "@loonext/rig-protocol";

/**
 * The edge itself, for the calls it makes on its own behalf: registering a
 * leg it relayed, rejecting a stranger, detaching a flooded number, halting
 * on an account signal, and the reads that corroborate one.
 *
 * Not in the protocol's CALLER_CLASSES, which are classes of bearer token.
 * It has to be distinct from all of them: a `rig-api` caller that could POST
 * /legs could register a production call's id and then command it. The edge
 * overwrites the header on every forward, so only the edge can send this.
 * Mirrors EDGE_CALLER in tools/edge/src/guard.ts until the protocol carries it.
 */
export const EDGE_CALLER = "edge";

export type GuardCaller = CallerClass | typeof EDGE_CALLER;

const KNOWN: ReadonlySet<string> = new Set<string>([...CALLER_CLASSES, EDGE_CALLER]);

export function parseCaller(value: string | null): GuardCaller | null {
  return value !== null && KNOWN.has(value) ? (value as GuardCaller) : null;
}

/** Edge-only routes beyond the protocol's `/legs` and `/reject`; mirrors EDGE_GUARD_ROUTES in the edge. */
export const EDGE_ROUTES = {
  detach: "/detach",
  halt: "/halt",
} as const;

/** The first path segment of each guard route, and the callers each admits. */
export const ROUTE_CALLERS: Readonly<Record<string, readonly GuardCaller[]>> = {
  // The edge only for GET /v2/balance and /v2/notification_events, checked in the route.
  [GUARD_ROUTES.telnyx]: ["rig-api", "robot", "admin", EDGE_CALLER],
  [GUARD_ROUTES.resend]: ["rig-api"],
  [GUARD_ROUTES.fcm]: ["rig-api"],
  [GUARD_ROUTES.fcmToken]: ["rig-api"],
  [GUARD_ROUTES.ai]: ["rig-api"],
  [GUARD_ROUTES.diag]: ["diag"],
  [GUARD_ROUTES.admin]: ["admin"],
  [GUARD_ROUTES.legs]: [EDGE_CALLER],
  [GUARD_ROUTES.reject]: [EDGE_CALLER],
  [EDGE_ROUTES.detach]: [EDGE_CALLER],
  [EDGE_ROUTES.halt]: [EDGE_CALLER],
  [GUARD_ROUTES.partition]: ["rig-api", "robot", "admin", EDGE_CALLER],
  [GUARD_ROUTES.lease]: ["rig-api", "robot", "admin"],
  [GUARD_ROUTES.health]: ["rig-api", "robot", "diag", "admin"],
  [GUARD_ROUTES.version]: ["rig-api", "robot", "diag", "admin"],
};

/** The route a path belongs to (`/telnyx/v2/calls` is `/telnyx`), or null. */
export function routeOf(pathname: string): string | null {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  return first in ROUTE_CALLERS ? first : null;
}

/**
 * Which Telnyx policy classes each caller may use. The robot dials, texts
 * and commands legs but never buys or binds anything; admin works through
 * /admin; the edge has its two reads and nothing from the registry.
 */
export const TELNYX_CLASSES_BY_CALLER: Readonly<Record<GuardCaller, ReadonlySet<string>>> = {
  "rig-api": new Set(["read", "leg-command", "dial", "message", "provisioning"]),
  robot: new Set(["read", "leg-command", "dial", "message"]),
  admin: new Set(["read"]),
  diag: new Set(),
  [EDGE_CALLER]: new Set(),
};
