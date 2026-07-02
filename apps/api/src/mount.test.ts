/**
 * Integration tests for the mounted middleware chain (SPEC §7, §10):
 * CORS → JWT → company context on /v1/*, /health outside the chain,
 * /webhooks/* unmounted and CORS-free. Exercises the REAL exported app;
 * only global fetch (JWKS + PostgREST) is stubbed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { app } from "./index";
import {
  companyMembersRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type CapturedRequest,
  type TestAuth,
} from "./test/support";

const env = completeEnv();
const ORIGIN = env.APP_ORIGIN;
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;

// Probe route registered behind the real /v1 chain so tests can observe the
// context the middleware attached. Module scope: Hono freezes its router on
// the first request.
app.get("/v1/__test__/context", (c) =>
  c.json({
    userId: c.get("userId"),
    companyId: c.get("companyId"),
    role: c.get("role"),
    memberId: c.get("memberId"),
  }),
);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("middleware order on /v1/* (CORS → JWT → company context)", () => {
  it("full chain: valid JWT + active membership reaches the handler with full context", async () => {
    const captured: CapturedRequest = {};
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [{ id: MEMBER_ID, role: "owner" }], captured),
    );
    const res = await app.request(
      "/v1/__test__/context",
      {
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: auth.subject,
      companyId: COMPANY_ID,
      role: "owner",
      memberId: MEMBER_ID,
    });
    // The membership lookup used the sub the JWT middleware verified —
    // proof that JWT ran before company context.
    expect(captured.url!.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
  });

  it("JWT runs before company context: no token is 401 even with a valid X-Company-Id", async () => {
    stubFetch(); // neither JWKS nor PostgREST may be touched
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { "X-Company-Id": COMPANY_ID } },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("company context runs after JWT: valid token without the header is 422", async () => {
    stubFetch(jwksRoute(auth));
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { Authorization: `Bearer ${await auth.token()}` } },
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
  });

  it("valid token but no membership is 403", async () => {
    stubFetch(jwksRoute(auth), companyMembersRoute(env, []));
    const res = await app.request(
      "/v1/__test__/context",
      {
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("/health stays outside the chain (no auth required)", async () => {
    stubFetch();
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("CORS (SPEC §7: exact origin, enumerated methods/headers, none on /webhooks/*)", () => {
  it("answers a preflight for the exact APP_ORIGIN without requiring auth", async () => {
    stubFetch(); // preflight must not hit JWT/JWKS at all
    const res = await app.request(
      "/v1/__test__/context",
      {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,x-company-id",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
      expect(methods).toContain(method);
    }
    const headers = res.headers.get("access-control-allow-headers") ?? "";
    for (const header of [
      "Authorization",
      "X-Company-Id",
      "Idempotency-Key",
      "Content-Type",
    ]) {
      expect(headers).toContain(header);
    }
  });

  it("echoes the allowed origin on actual /v1 responses (even auth failures)", async () => {
    stubFetch();
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("refuses any other origin (no wildcard, no echo)", async () => {
    stubFetch();
    const preflight = await app.request(
      "/v1/__test__/context",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

    const actual = await app.request(
      "/v1/__test__/context",
      { headers: { Origin: "https://evil.example" } },
      env,
    );
    expect(actual.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/webhooks/* does not exist yet and carries no CORS headers", async () => {
    stubFetch();
    for (const path of ["/webhooks/telnyx", "/webhooks/stripe"]) {
      const post = await app.request(
        path,
        { method: "POST", headers: { Origin: ORIGIN }, body: "{}" },
        env,
      );
      expect(post.status).toBe(404);
      expect(post.headers.get("access-control-allow-origin")).toBeNull();

      const preflight = await app.request(
        path,
        {
          method: "OPTIONS",
          headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
        },
        env,
      );
      expect(preflight.status).toBe(404);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight.headers.get("access-control-allow-methods")).toBeNull();
    }
  });
});
