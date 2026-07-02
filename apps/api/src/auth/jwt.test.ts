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
