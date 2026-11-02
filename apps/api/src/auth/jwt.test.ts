import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { expectedIssuer, jwtAuth } from "./jwt";

const env = completeEnv();
let auth: TestAuth;

// Probe app running the REAL middleware; the only stub is the JWKS fetch.
const app = new Hono<AppEnv>();
app.use("*", jwtAuth());
app.get("/whoami", (c) => c.json({ userId: c.get("userId") }));

beforeAll(async () => {
  auth = await createTestAuth(env);
});

beforeEach(() => {
  stubFetch(jwksRoute(auth));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(token?: string) {
  return app.request(
    "/whoami",
    { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } },
    env,
  );
}

async function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: { code: "unauthorized", message: expect.any(String) },
  });
}

describe("expectedIssuer", () => {
  it("is SUPABASE_URL + /auth/v1, tolerant of a trailing slash", () => {
    expect(expectedIssuer("https://x.supabase.co")).toBe(
      "https://x.supabase.co/auth/v1",
    );
    expect(expectedIssuer("https://x.supabase.co/")).toBe(
      "https://x.supabase.co/auth/v1",
    );
  });
});

describe("jwtAuth (SPEC §10: ES256 via JWKS, iss/aud/exp verified)", () => {
  it("accepts a valid token and attaches the sub as userId", async () => {
    const res = await request(await auth.token());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: auth.subject });
  });

  it("rejects an expired token with 401", async () => {
    await expectUnauthorized(await request(await auth.token({ expiresIn: -60 })));
  });

  it("rejects a wrong issuer with 401", async () => {
    await expectUnauthorized(
      await request(await auth.token({ issuer: "https://evil.example/auth/v1" })),
    );
  });

  it("rejects a wrong audience with 401", async () => {
    await expectUnauthorized(await request(await auth.token({ audience: "anon" })));
  });

  it("rejects a garbage token with 401", async () => {
    await expectUnauthorized(await request("not-a-jwt-at-all"));
  });

  it("rejects a missing Authorization header with 401", async () => {
    await expectUnauthorized(await request());
  });

  it("rejects a token signed by a key outside the JWKS with 401", async () => {
    const attacker = await generateKeyPair("ES256");
    await expectUnauthorized(
      await request(
        await auth.token({ key: attacker.privateKey, kid: "attacker-key" }),
      ),
    );
  });

  it("rejects a non-ES256 token even with valid claims (alg allowlist)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const hs256 = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(auth.issuer)
      .setAudience("authenticated")
      .setSubject(auth.subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode("a-symmetric-secret-of-decent-length"));
    await expectUnauthorized(await request(hs256));
  });

  it("rejects a valid token whose sub is missing with 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const noSub = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "test-es256-key" })
      .setIssuer(auth.issuer)
      .setAudience("authenticated")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(auth.privateKey);
    await expectUnauthorized(await request(noSub));
  });
});

describe("jwtAuth when the key set cannot be fetched (#251)", () => {
  // The resolver is cached per URL for the life of the isolate, so each case
  // gets a URL of its own and cannot inherit another's cached keys.
  let n = 0;
  const brokenEnv = () => ({
    ...env,
    SUPABASE_JWKS_URL: `https://identity-${(n += 1)}.example.test/auth/v1/.well-known/jwks.json`,
  });

  async function requestWith(token: string, jwksResponse: () => Response | Promise<Response>) {
    const e = brokenEnv();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (String(input).startsWith(e.SUPABASE_JWKS_URL)) return jwksResponse();
      throw new Error(`unstubbed fetch ${String(input)}`);
    });
    return app.request("/whoami", { headers: { Authorization: `Bearer ${token}` } }, e);
  }

  async function expectBusy(res: Response) {
    // A token that was never judged is not a bad token: 401 signs the person
    // out, 503 asks them to wait.
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({
      error: { code: "service_unavailable", message: expect.any(String) },
    });
  }

  it("answers 503, not 401, when the identity service errors", async () => {
    await expectBusy(await requestWith(await auth.token(), () => new Response("no", { status: 502 })));
  });

  it("answers 503, not 401, when the fetch itself dies", async () => {
    await expectBusy(
      await requestWith(await auth.token(), () => {
        throw new TypeError("fetch failed");
      }),
    );
  });

  it("answers 503, not 401, when the key set never arrives", async () => {
    // jose's own timeout is 5 s; abort the fetch the way it does.
    await expectBusy(
      await requestWith(
        await auth.token(),
        () =>
          new Promise<Response>((_resolve, reject) => {
            setTimeout(() => reject(new DOMException("aborted", "AbortError")), 10);
          }),
      ),
    );
  });

  it("still answers 401 for a token that is bad once the keys DO arrive", async () => {
    await expectUnauthorized(
      await requestWith(await auth.token({ expiresIn: -60 }), () =>
        Response.json({ keys: [auth.jwk] }),
      ),
    );
  });
});
