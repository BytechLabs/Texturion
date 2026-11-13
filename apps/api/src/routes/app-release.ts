/**
 * #339 — GET /app-release?platform=web|android|ios
 *
 * What we recommend, what we insist on, and why. One row per platform, read
 * from `app_release_policy`, so a floor can be lowered without shipping a
 * build — which is the whole reason the floor does not live in the client.
 *
 * PUBLIC, and outside /v1. The reason to demand an update is that something is
 * broken in the old build; #268 (signed out on a transient refresh failure) is
 * a live example. A gate readable only by clients with a working session is
 * open to everyone who does not need it and shut to everyone who does.
 *
 * FAILS OPEN, EVERY TIME. If the row is missing, the platform is unknown, or
 * the database is unreachable, this answers 200 with no demands rather than an
 * error. The client's own defaults do the same. That asymmetry is deliberate:
 * the cost of a missed prompt is one person on last week's build, and the cost
 * of a false block is every customer's business phone at once — which the
 * issue's devil's advocate names as the failure mode that matters, since a
 * misconfigured floor "locks out every user at once with no way in to fix it".
 */
import { Hono } from "hono";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";

export const appReleaseRoutes = new Hono<AppEnv>();

/** The platforms with a policy row. Anything else answers "no demands". */
const PLATFORMS = new Set(["web", "android", "ios"]);

export interface ReleasePolicy {
  platform: string;
  recommended_version: string | null;
  minimum_version: string | null;
  message: string | null;
  update_url: string | null;
}

/**
 * How long one isolate trusts a policy it read, and how long a client may reuse
 * the answer. Short enough that lowering a floor still takes effect within
 * minutes, which matters more than raising one, since lowering is the rollback.
 */
const POLICY_TTL_SECONDS = 300;

/** Successful reads only, per platform, for this isolate. */
const policyCache = new Map<string, { value: ReleasePolicy; expiresAt: number }>();

/** A fresh isolate is the production reset; tests need the same. */
export function resetReleasePolicyCache(): void {
  policyCache.clear();
}

/** The answer that asks nothing of anybody — every failure path returns this. */
function noDemands(platform: string): ReleasePolicy {
  return {
    platform,
    recommended_version: null,
    minimum_version: null,
    message: null,
    update_url: null,
  };
}

appReleaseRoutes.get("/app-release", async (c) => {
  const platform = (c.req.query("platform") ?? "").trim().toLowerCase();

  // Answer 200 rather than 400: a client that sent something unexpected must
  // end up unblocked, not stuck on an error it has no code path for.
  if (!PLATFORMS.has(platform)) {
    return c.json(noDemands(platform || "unknown"), 200, responseHeaders());
  }

  const now = Date.now();
  const hit = policyCache.get(platform);
  if (hit && hit.expiresAt > now) return c.json(hit.value, 200, responseHeaders());

  try {
    const db = getDb(getEnv(c.env));
    const { data, error } = await db.rpc("api_app_release_policy", {
      p_platform: platform,
    });
    if (error) throw new Error(error.message);
    const value = (data as ReleasePolicy | null) ?? noDemands(platform);
    policyCache.set(platform, { value, expiresAt: now + POLICY_TTL_SECONDS * 1000 });
    return c.json(value, 200, responseHeaders());
  } catch (cause) {
    // A database outage must not become a fleet-wide update screen. Logged so
    // it is not silent, answered permissively so it is not an incident. Never
    // cached, so the real policy is back on the next request after the outage.
    console.error(`app-release: policy read failed for ${platform}: ${String(cause)}`);
    return c.json(noDemands(platform), 200, responseHeaders());
  }
});

/**
 * The web app reads this cross-origin, so without CORS the browser discards the
 * answer. `*` is safe: the payload is public and the request carries no
 * credentials or custom headers, so it needs no preflight either.
 *
 * Cache-Control lets each client reuse the answer between launches. Cloudflare
 * does not cache a Worker's own responses, so it is the isolate memo above that
 * saves the database round trip, not the edge.
 */
function responseHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, max-age=${POLICY_TTL_SECONDS}`,
  };
}
