/**
 * The middleware decides signed in or out without asking Supabase Auth over the
 * network.
 *
 * It ran on every signed-in document, navigation and link prefetch, and called
 * getUser() each time: one round trip to Supabase before anything could render.
 * getClaims() checks the token's ES256 signature locally against the project's
 * signing keys, fetched once per isolate. Real enforcement stays in the API.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** vitest.config.ts sets NEXT_PUBLIC_SUPABASE_URL to https://project.supabase.co. */
const COOKIE = "sb-project-auth-token";
const KID = "middleware-test-key";

let middleware: typeof import("./middleware").middleware;
let signingKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };
let calls: string[] = [];

const base64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? bytes : Buffer.from(bytes)).toString("base64url");

async function accessToken(expiresInSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const payload = base64url(
    JSON.stringify({
      sub: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + expiresInSeconds,
      session_id: "00000000-0000-4000-8000-000000000002",
    }),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

async function sessionCookie(expiresInSeconds = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: await accessToken(expiresInSeconds),
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: now + expiresInSeconds,
    user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" },
  };
  return `${COOKIE}=base64-${base64url(JSON.stringify(session))}`;
}

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://app.loonext.com${path}`, cookie ? { headers: { cookie } } : undefined);
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID, alg: "ES256", use: "sig" };
  ({ middleware } = await import("./middleware"));
});

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(new URL(url).pathname);
    if (url.endsWith("/auth/v1/.well-known/jwks.json")) return Response.json({ keys: [publicJwk] });
    return new Response("unexpected request", { status: 500 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("middleware", () => {
  it("lets a signed-in member through without asking Supabase who they are", async () => {
    const response = await middleware(request("/inbox", await sessionCookie()));
    expect(response.headers.get("location")).toBeNull();
    expect(calls.filter((path) => path === "/auth/v1/user")).toEqual([]);
    expect(calls.filter((path) => path !== "/auth/v1/.well-known/jwks.json")).toEqual([]);
  });

  it("makes no request at all once the signing keys are cached", async () => {
    await middleware(request("/inbox", await sessionCookie()));
    calls = [];
    const response = await middleware(request("/tasks", await sessionCookie()));
    expect(response.headers.get("location")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("sends a visitor with no session to the login page, without a request", async () => {
    const response = await middleware(request("/inbox"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    expect(calls).toEqual([]);
  });

  it("still bounces a signed-in member off the login page", async () => {
    const response = await middleware(request("/login", await sessionCookie()));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/for-you");
  });

  it("refreshes an expired session through Supabase, as before", async () => {
    await middleware(request("/inbox", await sessionCookie(-60)));
    expect(calls).toContain("/auth/v1/token");
  });
});
