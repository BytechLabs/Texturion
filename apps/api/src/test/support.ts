/**
 * Test-only helpers (D13): the ONLY thing stubbed anywhere is the network
 * edge — global fetch — so every test exercises the real product code paths
 * (jose JWKS resolution, supabase-js PostgREST requests, Hono middleware).
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vitest";

import type { Env } from "../env";

/** A complete set of bindings, as `wrangler dev` would supply from .dev.vars. */
export function completeEnv(): Env {
  return {
    SUPABASE_URL: "https://abcdefghijkl.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
    SUPABASE_JWKS_URL:
      "https://abcdefghijkl.supabase.co/auth/v1/.well-known/jwks.json",
    TELNYX_API_KEY: "KEY0123456789ABCDEF",
    TELNYX_PUBLIC_KEY: "3fJ8mQz1xW9yK2vL5nB7cD4eF6gH8iJ0kL2mN4oP6qR=",
    STRIPE_SECRET_KEY: "rk_test_0123456789abcdef",
    STRIPE_WEBHOOK_SECRET: "whsec_0123456789abcdef",
    RESEND_API_KEY: "re_0123456789abcdef",
    SENTRY_DSN: "https://0123456789abcdef@o000001.ingest.sentry.io/0000001",
    APP_ORIGIN: "https://app.jobtext.app",
  };
}

export interface TokenOptions {
  issuer?: string;
  audience?: string;
  subject?: string;
  /** Seconds from now; negative mints an already-expired token. */
  expiresIn?: number;
  key?: CryptoKey;
  kid?: string;
}

export interface TestAuth {
  jwk: JWK;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  issuer: string;
  jwksUrl: string;
  /** The user id (`sub`) that `token()` mints by default. */
  subject: string;
  token(options?: TokenOptions): Promise<string>;
}

/**
 * Generates a REAL ES256 keypair and returns a signer that mints real JWTs
 * shaped like Supabase access tokens for the given env.
 */
export async function createTestAuth(
  env: Env = completeEnv(),
): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "test-es256-key";
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "ES256",
    use: "sig",
  };
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const subject = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";

  return {
    jwk,
    publicKey,
    privateKey,
    issuer,
    jwksUrl: env.SUPABASE_JWKS_URL,
    subject,
    async token(options: TokenOptions = {}): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = options.expiresIn ?? 300;
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: options.kid ?? kid })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? "authenticated")
        .setSubject(options.subject ?? subject)
        .setIssuedAt(now - 60)
        .setExpirationTime(now + expiresIn)
        .sign(options.key ?? privateKey);
    },
  };
}

export type FetchRoute = (
  url: URL,
  request: Request,
) => Response | Promise<Response> | undefined;

/**
 * Replace global fetch (the test-only network edge) with a dispatcher over the
 * given routes. Any request no route claims fails the test loudly. Restore
 * with `vi.unstubAllGlobals()`.
 */
export function stubFetch(...routes: FetchRoute[]): void {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(
        input instanceof Request ? input : String(input),
        init,
      );
      const url = new URL(request.url);
      for (const route of routes) {
        const response = await route(url, request);
        if (response) return response;
      }
      throw new Error(`Unstubbed fetch in test: ${request.method} ${url.href}`);
    },
  );
}

/** Serves the test JWKS document at the env's SUPABASE_JWKS_URL. */
export function jwksRoute(auth: TestAuth): FetchRoute {
  return (url) =>
    url.href === auth.jwksUrl
      ? Response.json({ keys: [auth.jwk] })
      : undefined;
}

/** Captured request details for asserting what the product code sent. */
export interface CapturedRequest {
  url?: URL;
  request?: Request;
}

/**
 * Serves the PostgREST `company_members` endpoint, returning `rows` and
 * capturing the query for assertions.
 */
export function companyMembersRoute(
  env: Env,
  rows: unknown[],
  captured?: CapturedRequest,
): FetchRoute {
  const prefix = `${env.SUPABASE_URL}/rest/v1/company_members`;
  return (url, request) => {
    if (!url.href.startsWith(prefix)) return undefined;
    if (captured) {
      captured.url = url;
      captured.request = request;
    }
    return Response.json(rows);
  };
}
