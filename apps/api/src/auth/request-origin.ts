/**
 * #236: where a request came from, in the two forms the sessions list shows —
 * which app, and roughly where.
 *
 * Both are best-effort by design. They label a row in a "these are your signed
 * in devices" list so a person can recognise their own phone; nothing
 * authorizes on them, so a spoofed header costs an attacker nothing and buys
 * them nothing.
 */
import type { Context } from "hono";

import type { AppEnv } from "../context";

export type ClientKind = "web" | "android" | "ios" | "unknown";

const CLIENTS: ReadonlySet<string> = new Set(["web", "android", "ios"]);

/**
 * Which app is calling.
 *
 * `X-Client` is the answer when the client sends one — all three clients do
 * since #236. The User-Agent fallback exists for the build already on
 * somebody's phone: an app that has not been updated still deserves a row
 * that says "Android" rather than "unknown", and the native HTTP stacks are
 * distinctive enough to name (OkHttp on Android, CFNetwork/Darwin on iOS).
 * Anything else is a browser, which is what `web` means here.
 */
export function requestClient(c: Context<AppEnv>): ClientKind {
  const declared = c.req.header("X-Client")?.trim().toLowerCase();
  if (declared && CLIENTS.has(declared)) return declared as ClientKind;

  const ua = c.req.header("User-Agent") ?? "";
  if (/okhttp|dalvik|\bandroid\b/i.test(ua)) return "android";
  if (/cfnetwork|darwin|\b(iphone|ipad)\b/i.test(ua)) return "ios";
  if (/mozilla|webkit|chrome|safari|firefox/i.test(ua)) return "web";
  return "unknown";
}

export interface RequestGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/**
 * Approximate location, from Cloudflare's own geo on the request.
 *
 * Deliberately NOT an IP lookup, and deliberately not the IP itself: the
 * sessions list needs "Toronto, Canada" so somebody can tell their own phone
 * from a stranger's, and a city is the whole of what it needs. Storing the
 * address would be keeping a precise identifier to render an imprecise one.
 *
 * Absent everywhere except a real Cloudflare edge (local dev, tests), which
 * the column tolerates — a row with no city is a row that says less, not a
 * broken one.
 */
export function requestGeo(c: Context<AppEnv>): RequestGeo {
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf;
  const pick = (key: string): string | null => {
    const value = cf?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return {
    country: pick("country") ?? c.req.header("CF-IPCountry") ?? null,
    region: pick("region"),
    city: pick("city"),
  };
}
