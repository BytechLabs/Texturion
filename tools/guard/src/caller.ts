import {
  CALLER_CLASSES,
  EDGE_CALLER,
  EDGE_ONLY_ROUTES,
  GUARD_ROUTES,
  type CallerClass,
  type EdgeCaller,
} from "@loonext/rig-protocol";

export type GuardCaller = CallerClass | EdgeCaller;

const KNOWN: ReadonlySet<string> = new Set<string>([...CALLER_CLASSES, EDGE_CALLER]);

export function parseCaller(value: string | null): GuardCaller | null {
  return value !== null && KNOWN.has(value) ? (value as GuardCaller) : null;
}

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
  ...Object.fromEntries(EDGE_ONLY_ROUTES.map((route) => [route, [EDGE_CALLER]])),
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
