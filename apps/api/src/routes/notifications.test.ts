/**
 * Notification prefs + push subscription routes (SPEC §7, §8): per-user
 * per-company prefs read/upsert (missing rows read as the §6 defaults),
 * subscription registration with real key-shape validation, and
 * caller-scoped deletion.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { notificationsRoutes } from "./notifications";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const SUB_ID = "bcbcbcbc-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(notificationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function memberStub(): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  return sb;
}

/** A real browser-shaped subscription body (structurally valid keys). */
async function subscriptionBody() {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
  );
  const b64u = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    endpoint: "https://push.example.net/send/device-1",
    keys: {
      p256dh: b64u(raw),
      auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

describe("GET /v1/notification-prefs", () => {
  it("returns the caller's row, scoped to user AND company", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      { email_enabled: false, push_enabled: true },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    // The response also carries the server's VAPID application key (SPEC §8)
    // — the browser's PushManager.subscribe() applicationServerKey source.
    expect(await res.json()).toEqual({
      email_enabled: false,
      push_enabled: true,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
    });

    const call = sb.find("GET", "/rest/v1/notification_prefs")[0];
    expect(call.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("reads a missing row as the §6 defaults (true/true)", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      { companyId: COMPANY_ID },
    );
    expect(await res.json()).toEqual({
      email_enabled: true,
      push_enabled: true,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
    });
  });
});

describe("PUT /v1/notification-prefs", () => {
  it("upserts on (user_id, company_id) and echoes the saved prefs", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/notification_prefs", () =>
      Response.json([{ email_enabled: true, push_enabled: false }], {
        status: 201,
      }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { email_enabled: true, push_enabled: false },
      },
    );
    expect(res.status).toBe(200);
    // PUT echoes the GET shape (key included) so a toggle save never strips
    // the VAPID key from a client cache.
    expect(await res.json()).toEqual({
      email_enabled: true,
      push_enabled: false,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
    });

    const upsert = sb.find("POST", "/rest/v1/notification_prefs")[0];
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "user_id,company_id",
    );
    expect(upsert.body).toMatchObject({
      user_id: auth.subject,
      company_id: COMPANY_ID,
      email_enabled: true,
      push_enabled: false,
    });
    expect(upsert.headers.get("prefer")).toContain(
      "resolution=merge-duplicates",
    );
  });

  it("422s partial or mistyped bodies (both toggles are required)", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [
      {},
      { email_enabled: true },
      { email_enabled: "yes", push_enabled: true },
    ]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/notification-prefs",
        { method: "PUT", companyId: COMPANY_ID, body },
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("POST /v1/push-subscriptions", () => {
  it("upserts on (user_id, endpoint) so re-subscribes refresh rotated keys", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/push_subscriptions", () =>
      Response.json(
        [
          {
            id: SUB_ID,
            endpoint: "https://push.example.net/send/device-1",
            created_at: "2026-07-01T12:00:00+00:00",
          },
        ],
        { status: 201 },
      ),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const body = await subscriptionBody();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/push-subscriptions",
      {
        method: "POST",
        companyId: COMPANY_ID,
        body,
        headers: { "User-Agent": "TestBrowser/1.0" },
      },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: SUB_ID,
      endpoint: "https://push.example.net/send/device-1",
      created_at: "2026-07-01T12:00:00+00:00",
    });

    const upsert = sb.find("POST", "/rest/v1/push_subscriptions")[0];
    expect(upsert.url.searchParams.get("on_conflict")).toBe("user_id,endpoint");
    expect(upsert.body).toMatchObject({
      user_id: auth.subject,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: "TestBrowser/1.0",
    });
  });

  it("422s non-https endpoints and keys that could never be encrypted to", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);

    const valid = await subscriptionBody();
    const bad = [
      { ...valid, endpoint: "http://push.example.net/send/x" },
      { ...valid, keys: { ...valid.keys, p256dh: "bm90LWEta2V5" } }, // wrong length
      { ...valid, keys: { ...valid.keys, auth: "c2hvcnQ" } }, // not 16 bytes
      { endpoint: valid.endpoint }, // keys missing entirely
    ];
    for (const body of bad) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/push-subscriptions",
        { method: "POST", companyId: COMPANY_ID, body },
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(sb.find("POST", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });
});

describe("DELETE /v1/push-subscriptions/:id", () => {
  it("deletes only the caller's own subscription", async () => {
    const sb = memberStub();
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => [{ id: SUB_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/push-subscriptions/${SUB_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);

    const del = sb.find("DELETE", "/rest/v1/push_subscriptions")[0];
    expect(del.url.searchParams.get("id")).toBe(`eq.${SUB_ID}`);
    expect(del.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
  });

  it("404s an unknown (or another user's) subscription", async () => {
    const sb = memberStub();
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/push-subscriptions/${SUB_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });
});
