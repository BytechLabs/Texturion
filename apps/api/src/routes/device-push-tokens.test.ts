/**
 * Native device push-token routes (#151): Bearer-only registration (no
 * X-Company-Id — tokens are per-user like push_subscriptions), upsert on
 * (user_id, token), the #30-style cap-and-evict, shape validation, and
 * caller-scoped deletion by token.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { devicePushTokensRoutes } from "./device-push-tokens";

const env = completeEnv();
const ROW_ID = "bcbcbcbc-1111-4222-8333-444444444444";
const TOKEN = "fRegToken-abc123:APA91bTestRegistrationToken_0000000000";

let auth: TestAuth;
const app = buildTestApp(devicePushTokensRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/device-push-tokens", () => {
  it("upserts on (user_id, token) Bearer-only — no X-Company-Id, no membership probe", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/device_push_tokens", () =>
      Response.json(
        [{ id: ROW_ID, platform: "android", created_at: "2026-07-15T12:00:00+00:00" }],
        { status: 201 },
      ),
    );
    // Cap lookup: well under the cap → no eviction.
    sb.on("GET", "/rest/v1/device_push_tokens", () => [
      { created_at: "2026-07-15T12:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      {
        method: "POST",
        companyId: null, // Bearer-only: the exempt route needs no company scope
        body: { platform: "android", token: TOKEN },
      },
    );
    expect(res.status).toBe(201);
    // The token itself is never echoed back (the device already holds it).
    expect(await res.json()).toEqual({
      id: ROW_ID,
      platform: "android",
      created_at: "2026-07-15T12:00:00+00:00",
    });

    // No company context was ever resolved (per-user resource).
    expect(sb.find("GET", "/rest/v1/company_members")).toHaveLength(0);

    const upsert = sb.find("POST", "/rest/v1/device_push_tokens")[0];
    expect(upsert.url.searchParams.get("on_conflict")).toBe("user_id,token");
    expect(upsert.body).toMatchObject({
      user_id: auth.subject,
      platform: "android",
      token: TOKEN,
    });
    // Re-registers refresh liveness.
    expect(
      typeof (upsert.body as Record<string, unknown>).last_seen_at,
    ).toBe("string");
    expect(upsert.headers.get("prefer")).toContain(
      "resolution=merge-duplicates",
    );

    // Under the cap, nothing is evicted.
    expect(sb.find("DELETE", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("cap-and-drop (#30 mirror): a register at the cap evicts everything older than the newest 10", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/device_push_tokens", () =>
      Response.json(
        [{ id: ROW_ID, platform: "ios", created_at: "2026-07-15T12:00:00+00:00" }],
        { status: 201 },
      ),
    );
    // A FULL page of 10 (newest-first): the 10th row's created_at is the cutoff.
    sb.on("GET", "/rest/v1/device_push_tokens", () =>
      Array.from({ length: 10 }, (_, i) => ({
        created_at: `2026-07-15T${String(23 - i).padStart(2, "0")}:00:00+00:00`,
      })),
    );
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => [
      { id: "dddddddd-1111-4222-8333-444444444444" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      {
        method: "POST",
        companyId: null,
        body: { platform: "ios", token: TOKEN },
      },
    );
    expect(res.status).toBe(201);

    // Cap lookup: caller-scoped, newest-first, limited to the cap.
    const lookup = sb.find("GET", "/rest/v1/device_push_tokens")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(lookup.url.searchParams.get("order")).toBe("created_at.desc");
    expect(lookup.url.searchParams.get("limit")).toBe("10");

    // Eviction: caller-scoped delete of everything OLDER than the 10th-newest.
    const del = sb.find("DELETE", "/rest/v1/device_push_tokens")[0];
    expect(del.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(del.url.searchParams.get("created_at")).toBe(
      "lt.2026-07-15T14:00:00+00:00",
    );
  });

  it("a partial page (under the cap) never issues an eviction", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/device_push_tokens", () =>
      Response.json(
        [{ id: ROW_ID, platform: "android", created_at: "2026-07-15T12:00:00+00:00" }],
        { status: 201 },
      ),
    );
    sb.on("GET", "/rest/v1/device_push_tokens", () =>
      Array.from({ length: 9 }, () => ({
        created_at: "2026-07-01T00:00:00+00:00",
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      {
        method: "POST",
        companyId: null,
        body: { platform: "android", token: TOKEN },
      },
    );
    expect(res.status).toBe(201);
    expect(sb.find("DELETE", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("422s unknown platforms and missing/oversized tokens", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);

    const bad = [
      {},
      { platform: "android" }, // token missing
      { token: TOKEN }, // platform missing
      { platform: "windows", token: TOKEN }, // not android|ios
      { platform: "android", token: "" }, // empty token
      { platform: "ios", token: "x".repeat(4097) }, // over the bound
    ];
    for (const body of bad) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/device-push-tokens",
        { method: "POST", companyId: null, body },
      );
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(422);
    }
    expect(sb.find("POST", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("401s without a Bearer token (Bearer-only, not auth-free)", async () => {
    stubFetch(); // any network call would fail the test loudly
    const res = await app.request(
      "/v1/device-push-tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "android", token: TOKEN }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /v1/device-push-tokens", () => {
  it("deletes only the caller's own row, matched by token", async () => {
    const sb = supabaseStub(env);
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => [{ id: ROW_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      { method: "DELETE", companyId: null, body: { token: TOKEN } },
    );
    expect(res.status).toBe(204);

    const del = sb.find("DELETE", "/rest/v1/device_push_tokens")[0];
    expect(del.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(del.url.searchParams.get("token")).toBe(`eq.${TOKEN}`);
  });

  it("404s an unknown (or another user's) token", async () => {
    const sb = supabaseStub(env);
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      { method: "DELETE", companyId: null, body: { token: TOKEN } },
    );
    expect(res.status).toBe(404);
  });

  it("422s a missing token", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/device-push-tokens",
      { method: "DELETE", companyId: null, body: {} },
    );
    expect(res.status).toBe(422);
    expect(sb.find("DELETE", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });
});
