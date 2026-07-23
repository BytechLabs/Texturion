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
  // #106: the read-model routes resolve number_access; [] = no rules →
  // unrestricted (p_hidden_number_ids null), so the RPC assertions are unchanged.
  sb.on("GET", "/rest/v1/number_access", () => []);
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
    // #30 cap lookup: well under the cap → no eviction.
    sb.on("GET", "/rest/v1/push_subscriptions", () => [
      { created_at: "2026-07-01T12:00:00+00:00" },
    ]);
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

    // #30: under the cap, nothing is evicted.
    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });

  it("#30 cap-and-drop: a subscribe at the cap evicts everything older than the newest 10", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/push_subscriptions", () =>
      Response.json(
        [
          {
            id: SUB_ID,
            endpoint: "https://push.example.net/send/device-new",
            created_at: "2026-07-07T12:00:00+00:00",
          },
        ],
        { status: 201 },
      ),
    );
    // The cap lookup returns a FULL page of 10 (newest-first): the 10th row's
    // created_at is the eviction cutoff.
    sb.on("GET", "/rest/v1/push_subscriptions", () =>
      Array.from({ length: 10 }, (_, i) => ({
        created_at: `2026-07-07T${String(23 - i).padStart(2, "0")}:00:00+00:00`,
      })),
    );
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => [
      { id: "dddddddd-1111-4222-8333-444444444444" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/push-subscriptions",
      { method: "POST", companyId: COMPANY_ID, body: await subscriptionBody() },
    );
    expect(res.status).toBe(201);

    // Cap lookup: caller-scoped, newest-first, limited to the cap.
    const lookup = sb.find("GET", "/rest/v1/push_subscriptions")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(lookup.url.searchParams.get("order")).toBe("created_at.desc");
    expect(lookup.url.searchParams.get("limit")).toBe("10");

    // Eviction: caller-scoped delete of everything OLDER than the 10th-newest
    // row (oldest first goes; the newest 10 survive).
    const del = sb.find("DELETE", "/rest/v1/push_subscriptions")[0];
    expect(del.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(del.url.searchParams.get("created_at")).toBe(
      "lt.2026-07-07T14:00:00+00:00",
    );
  });

  it("#30: a partial page (under the cap) never issues an eviction", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/push_subscriptions", () =>
      Response.json(
        [{ id: SUB_ID, endpoint: "https://p.example.net/x", created_at: "2026-07-07T12:00:00+00:00" }],
        { status: 201 },
      ),
    );
    sb.on("GET", "/rest/v1/push_subscriptions", () =>
      Array.from({ length: 9 }, () => ({
        created_at: "2026-07-01T00:00:00+00:00",
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/push-subscriptions",
      { method: "POST", companyId: COMPANY_ID, body: await subscriptionBody() },
    );
    expect(res.status).toBe(201);
    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// D24 notifications read-model (DERIVED, no feed table). The union + unread
// watermark live in the api_notifications* RPCs (exercised by the DB suite);
// these stub the RPC network edge and assert the route wiring: caller/company
// scoping, cursor pagination, the unread dot passthrough, the bell count, and
// the mark-read watermark advance.
// ---------------------------------------------------------------------------

const NOTIF_A = {
  id: "e1000000-0000-4000-8000-000000000001",
  type: "inbound_message",
  conversation_id: "c1000000-0000-4000-8000-000000000001",
  message_id: "b1000000-0000-4000-8000-000000000001",
  task_id: null,
  contact: { id: "d1", name: "Jane", phone_e164: "+16135550100" },
  created_at: "2026-07-02T12:00:00+00:00",
  unread: true,
};
const NOTIF_B = {
  id: "e1000000-0000-4000-8000-000000000002",
  type: "task_assigned",
  conversation_id: "c1000000-0000-4000-8000-000000000002",
  message_id: null,
  task_id: "a1000000-0000-4000-8000-000000000002",
  contact: { id: "d2", name: null, phone_e164: "+16135550200" },
  created_at: "2026-07-02T11:00:00+00:00",
  unread: false,
};

describe("GET /v1/notifications", () => {
  it("lists derived notifications, scoped to caller + company, no next page", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_notifications", () => [NOTIF_A, NOTIF_B]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [NOTIF_A, NOTIF_B],
      next_cursor: null,
    });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_notifications")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_limit: 26, // default 25 + 1 (the has-next-page probe row)
      p_before_ts: null,
      p_before_id: null,
    });
  });

  it("#106: a restricted member's list RPC receives the hidden-number deny list", async () => {
    const HIDDEN = "dddddddd-0000-4000-8000-00000000000d";
    // Build the stub directly so the hiding rule is the FIRST number_access
    // responder (responders resolve in registration order).
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/number_access", () => [
      {
        phone_number_id: HIDDEN,
        principal_kind: "role",
        principal: "admin",
        level: "text",
      },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_notifications", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_notifications")[0];
    expect((rpc.body as Record<string, unknown>).p_hidden_number_ids).toEqual([
      HIDDEN,
    ]);
  });

  it("emits a next_cursor when the page is full (limit+1 rows returned)", async () => {
    const sb = memberStub();
    // limit=1 → route fetches 2; the extra row signals a next page and is
    // trimmed. next_cursor encodes the last KEPT row's (created_at, id).
    sb.on("POST", "/rest/v1/rpc/api_notifications", () => [NOTIF_A, NOTIF_B]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications?limit=1",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      data: unknown[];
      next_cursor: string | null;
    };
    expect(body.data).toEqual([NOTIF_A]);
    expect(body.next_cursor).not.toBeNull();

    // Following the cursor forwards (created_at, id) into p_before_ts/id.
    const follow = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/notifications?limit=1&cursor=${body.next_cursor}`,
      { companyId: COMPANY_ID },
    );
    expect(follow.status).toBe(200);
    const followRpc = sb.find("POST", "/rest/v1/rpc/api_notifications")[1];
    expect(followRpc.body).toMatchObject({
      p_before_ts: NOTIF_A.created_at,
      p_before_id: NOTIF_A.id,
      p_limit: 2,
    });
  });

  it("preserves the per-item unread dot from the RPC", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_notifications", () => [NOTIF_A, NOTIF_B]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { unread: boolean }[] };
    expect(body.data.map((n) => n.unread)).toEqual([true, false]);
  });

  it("422s a garbage cursor", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications?cursor=not-a-cursor",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/api_notifications")).toHaveLength(0);
  });
});

describe("GET /v1/notifications/unread-count", () => {
  it("returns the bell badge count from the RPC", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_notifications_unread_count", () => 4);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/unread-count",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 4 });

    const rpc = sb.find(
      "POST",
      "/rest/v1/rpc/api_notifications_unread_count",
    )[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      // #106: unrestricted caller → null deny list (no filter).
      p_hidden_number_ids: null,
    });
  });

  it("a PostgREST bigint-as-string count is coerced to a number", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_notifications_unread_count", () => "7");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/unread-count",
      { companyId: COMPANY_ID },
    );
    expect(await res.json()).toEqual({ count: 7 });
  });
});

describe("POST /v1/notifications/mark-all-read", () => {
  it("advances the watermark on the DB clock and echoes it", async () => {
    const sb = memberStub();
    sb.on(
      "POST",
      "/rest/v1/rpc/api_mark_notifications_read",
      () => "2026-07-02T13:00:00+00:00",
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/mark-all-read",
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      last_seen_at: "2026-07-02T13:00:00+00:00",
    });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_mark_notifications_read")[0];
    // #188: p_now is NULL — the RPC stamps the DB's own now(). Item
    // created_at values are DB-stamped; a Worker-clock watermark could land
    // BEFORE the newest item and the badge would never zero. The DB-suite
    // twin (for_you_notifications.test.sql NR2) asserts the count zeroes.
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_now: null,
    });
  });
});

describe("POST /v1/notifications/:id/read", () => {
  const READ_PATH = `/v1/notifications/${NOTIF_A.id}/read`;

  it("marks ONE notification read via the per-item RPC", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_mark_notification_read", () => true);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), READ_PATH, {
      method: "POST",
      companyId: COMPANY_ID,
      body: { created_at: NOTIF_A.created_at },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newly_read: true });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_mark_notification_read")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_notification_id: NOTIF_A.id,
      p_created_at: NOTIF_A.created_at,
    });
  });

  it("is idempotent: an already-read item reports newly_read false", async () => {
    const sb = memberStub();
    // The RPC's ON CONFLICT DO NOTHING (or watermark coverage) → false; the
    // route surfaces it as a 200, never an error (re-tapping is normal).
    sb.on("POST", "/rest/v1/rpc/api_mark_notification_read", () => false);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), READ_PATH, {
      method: "POST",
      companyId: COMPANY_ID,
      body: { created_at: NOTIF_A.created_at },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newly_read: false });
  });

  it("404s a malformed notification id before any RPC", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/not-a-uuid/read",
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { created_at: NOTIF_A.created_at },
      },
    );
    expect(res.status).toBe(404);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_mark_notification_read"),
    ).toHaveLength(0);
  });

  it("422s a missing or non-ISO created_at", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [{}, { created_at: "yesterday" }, { created_at: 5 }]) {
      const res = await apiRequest(app, env, await auth.token(), READ_PATH, {
        method: "POST",
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(
      sb.find("POST", "/rest/v1/rpc/api_mark_notification_read"),
    ).toHaveLength(0);
  });
});

describe("POST /v1/notifications/mark-read", () => {
  it("advances the watermark to a specific notification's timestamp", async () => {
    const sb = memberStub();
    sb.on(
      "POST",
      "/rest/v1/rpc/api_mark_notifications_read",
      () => NOTIF_A.created_at,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/mark-read",
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { before: NOTIF_A.created_at },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ last_seen_at: NOTIF_A.created_at });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_mark_notifications_read")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_now: NOTIF_A.created_at, // the route passes `before` through as p_now
    });
  });

  it("422s a missing or non-ISO `before`", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [{}, { before: "yesterday" }, { before: 12345 }]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/notifications/mark-read",
        { method: "POST", companyId: COMPANY_ID, body },
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(
      sb.find("POST", "/rest/v1/rpc/api_mark_notifications_read"),
    ).toHaveLength(0);
  });
});
