import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AppEnv } from "../context";
import { getEnv, type Env } from "../env";
import { errorResponse } from "../http/errors";

/**
 * Remote JWKS resolvers cached per isolate, keyed by URL. jose caches the
 * fetched key set internally (HTTP-cache aware, with a refetch cooldown), so
 * recreating the resolver per request would throw that caching away and
 * refetch Supabase's JWKS (itself edge-cached ~10 min upstream, SPEC §10) on
 * every call.
 */
const jwksResolvers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(url: string) {
  let resolver = jwksResolvers.get(url);
  if (!resolver) {
    // Explicit options rather than jose's defaults. The one that matters is
    // `cooldownDuration`: a freshly-signed token whose `kid` is not yet in the
    // cached JWKS (Supabase edge-caches it ~10 min upstream) must trigger a
    // prompt refetch — jose's default 30s cooldown would 401 the very first
    // authenticated call after a brand-new signup for up to half a minute.
    resolver = createRemoteJWKSet(new URL(url), {
      cooldownDuration: 5_000,
      timeoutDuration: 5_000,
      cacheMaxAge: 600_000,
    });
    jwksResolvers.set(url, resolver);
  }
  return resolver;
}

/** The `iss` claim Supabase Auth mints: `<SUPABASE_URL>/auth/v1` (SPEC §10). */
export function expectedIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/**
 * Verify a Supabase access token locally against the project JWKS (SPEC §10):
 * ES256 only, `iss` = SUPABASE_URL + '/auth/v1', `aud` = 'authenticated',
 * `exp` enforced by jose. Throws on any failure.
 */
export async function verifyAccessToken(
  token: string,
  env: Env,
): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, remoteJwks(env.SUPABASE_JWKS_URL), {
    algorithms: ["ES256"],
    issuer: expectedIssuer(env.SUPABASE_URL),
    audience: "authenticated",
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("token has no subject");
  }
  return { userId: payload.sub };
}

/**
 * JWT middleware for /v1/* (SPEC §7, §10). On success attaches `userId`
 * (the verified `sub`); any failure — missing header, malformed token, bad
 * signature, wrong iss/aud/alg, expired — is a uniform 401 `unauthorized`.
 */
export function jwtAuth() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const env = getEnv(c.env);
    const authorization = c.req.header("Authorization");
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    if (!token) {
      return errorResponse(c, "unauthorized", "Missing or invalid access token.");
    }
    try {
      const { userId } = await verifyAccessToken(token, env);
      c.set("userId", userId);
    } catch {
      // Never leak why verification failed (SPEC §7: 401 `unauthorized`).
      return errorResponse(c, "unauthorized", "Missing or invalid access token.");
    }
    await next();
  });
}
