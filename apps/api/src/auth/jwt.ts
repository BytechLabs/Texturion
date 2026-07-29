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
): Promise<{ userId: string; sessionId: string | null }> {
  const { payload } = await jwtVerify(token, remoteJwks(env.SUPABASE_JWKS_URL), {
    algorithms: ["ES256"],
    issuer: expectedIssuer(env.SUPABASE_URL),
    audience: "authenticated",
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("token has no subject");
  }
  // #236: `session_id` is the GoTrue session this token was minted for, and
  // it is what makes revocation possible without waiting out the expiry.
  // Null is tolerated rather than rejected: the claim lives INSIDE the signed
  // token, so a caller cannot strip it to dodge the check — its absence only
  // ever means a token from before GoTrue emitted one, and failing those
  // closed would sign out the whole customer base to fix nothing.
  const sessionId =
    typeof payload.session_id === "string" && SESSION_ID_RE.test(payload.session_id)
      ? payload.session_id
      : null;
  return { userId: payload.sub, sessionId };
}

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const { userId, sessionId } = await verifyAccessToken(token, env);
      c.set("userId", userId);
      if (sessionId) c.set("sessionId", sessionId);
    } catch {
      // Never leak why verification failed (SPEC §7: 401 `unauthorized`).
      return errorResponse(c, "unauthorized", "Missing or invalid access token.");
    }
    await next();
  });
}
