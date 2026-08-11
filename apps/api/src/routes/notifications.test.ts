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
import { notifyMissedCall } from "../notifications/missed-call";
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

function memberStub(
  // #581: the caller's ROLE is a parameter now. The read-model routes and the
  // prefs routes no longer answer to the same capability, so a suite about this
  // file has to be able to arrive as somebody other than a plain member.
  options: { pause?: unknown; role?: string } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "member"),
  );
  // #106: the read-model routes resolve number_access; [] = no rules →
  // unrestricted (p_hidden_number_ids null), so the RPC assertions are unchanged.
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  // #343: the badge endpoint now also reports whether the workspace's daily
  // notification allowance is spent. Nothing paused by default.
  // Handlers are tried in REGISTRATION order and the first match wins, so a
  // later `sb.on` for the same path never runs — the pause is a parameter
  // rather than something a test overrides afterwards.
  sb.on("POST", "/rest/v1/rpc/api_notification_pause", () => options.pause ?? NOT_PAUSED);
  return sb;
}

/** #343: the healthy state — allowance untouched. */
const NOT_PAUSED = {
  email_paused: false,
  push_paused: false,
  resets_at: "2026-07-28T07:00:00+00:00",
};

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
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
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
      // #244: no quiet-hours window, which is every existing member. Named
      // explicitly rather than omitted — a client that cannot tell "no window"
      // from "the server did not say" would have to guess.
      quiet_from: null,
      quiet_to: null,
      quiet_timezone: null,
      // #297: nothing quietened, no window, no summary — what every member
      // receives today, and named for the same reason as the fields above.
      delivery: {},
      batch_window_minutes: null,
      summary_at: null,
      vapid_public_key: env.VAPID_PUBLIC_KEY,
    });
  });
});

describe("#552 PUT accepts the clock GET just served", () => {
  /**
   * THE FOUNDER'S BUG. quiet_from/quiet_to/summary_at are Postgres `time`
   * columns, and a `time` serialises to JSON as "21:30:00" — so GET handed the
   * client a value the PUT schema then refused, and quiet hours could not be
   * saved at all. Proven outside this suite:
   *
   *   select to_jsonb('21:30'::time)  ->  "21:30:00"
   *
   * A validator that rejects what its own GET just served is a round trip that
   * cannot close.
   */
  it("accepts a time with seconds, as the column actually serves it", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/notification_prefs", () =>
      Response.json([{ email_enabled: true, push_enabled: true }], { status: 201 }),
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
        body: {
          email_enabled: true,
          push_enabled: true,
          quiet_from: "21:30:00",
          quiet_to: "07:00:00",
          quiet_timezone: "America/Toronto",
          summary_at: "08:00:00",
        },
      },
    );
    expect(res.status).toBe(200);

    // And the seconds are dropped on the way in, so the column stores the wall
    // clock the client meant rather than two shapes of the same time.
    const upsert = sb.find("POST", "/rest/v1/notification_prefs")[0];
    expect(upsert.body).toMatchObject({
      quiet_from: "21:30",
      quiet_to: "07:00",
      summary_at: "08:00",
    });
  });

  it("still accepts a bare HH:MM, which is what the clients send", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/notification_prefs", () =>
      Response.json([{ email_enabled: true, push_enabled: true }], { status: 201 }),
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
        // BOTH halves: #244 requires it, and a window with one end is not a
        // window. The first version of this test sent only quiet_from, got the
        // 422 it deserved, and was the test that was wrong.
        body: {
          email_enabled: true,
          push_enabled: true,
          quiet_from: "21:30",
          quiet_to: "07:00",
        },
      },
    );
    expect(res.status).toBe(200);
  });

  it("still refuses a time that is not one", async () => {
    // The positive twin: a schema that accepted anything would also pass both
    // tests above.
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { email_enabled: true, push_enabled: true, quiet_from: "25:99" },
      },
    );
    expect(res.status).toBe(422);
  });
});

describe("PUT /v1/notification-prefs", () => {
  it("upserts on (user_id, company_id) and echoes the saved prefs", async () => {
    const sb = memberStub();
    // #552: the stub now returns what PostgREST returns for the route's select
    // list — ALL EIGHT columns. It used to return two, and the assertion below
    // used to expect two, so the test passed while the shipped behaviour silently
    // dropped the grouping and the quiet window on every save.
    sb.on("POST", "/rest/v1/notification_prefs", () =>
      Response.json(
        [
          {
            email_enabled: true,
            push_enabled: false,
            quiet_from: "21:30:00",
            quiet_to: "07:00:00",
            quiet_timezone: "America/Toronto",
            delivery: { messages: "batched" },
            batch_window_minutes: 30,
            summary_at: "08:00:00",
          },
        ],
        { status: 201 },
      ),
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
    //
    // #552: and never strips a SETTING either. Every client replaces its whole
    // state with this object, so a missing field disappeared from the screen and
    // was then written back as null by the next save — a toggle deleting its
    // neighbour.
    expect(await res.json()).toEqual({
      email_enabled: true,
      push_enabled: false,
      quiet_from: "21:30:00",
      quiet_to: "07:00:00",
      quiet_timezone: "America/Toronto",
      delivery: { messages: "batched" },
      batch_window_minutes: 30,
      summary_at: "08:00:00",
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
            endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
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
      endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
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
            endpoint: "https://fcm.googleapis.com/fcm/send/device-new",
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
        [{ id: SUB_ID, endpoint: "https://fcm.googleapis.com/fcm/send/x", created_at: "2026-07-07T12:00:00+00:00" }],
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

  it("422s an endpoint that is not a push service (#576: no blind relay)", async () => {
    // The stored endpoint is later POSTed to by the Worker, so accepting any
    // https URL made this a request-forwarding primitive with our egress
    // behind it. The same predicate runs again at the send — this door is the
    // courtesy, that one is the protection.
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    const valid = await subscriptionBody();

    for (const endpoint of [
      "https://attacker.test/collect",
      "https://169.254.169.254/latest/meta-data/",
      "https://notify.windows.com.evil.test/w/",
    ]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/push-subscriptions",
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { ...valid, endpoint },
        },
      );
      expect(res.status, endpoint).toBe(422);
    }
  });

  it("422s non-https endpoints and keys that could never be encrypted to", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);

    const valid = await subscriptionBody();
    const bad = [
      { ...valid, endpoint: "http://fcm.googleapis.com/fcm/send/x" },
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
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN, level: "none" },
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
    expect(await res.json()).toEqual({ count: 4, alert_pause: NOT_PAUSED });

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
    expect(await res.json()).toEqual({ count: 7, alert_pause: NOT_PAUSED });
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

describe("GET /v1/notifications/unread-count — the pause a member can see (#343)", () => {
  it("reports that email is paused, and when it lifts", async () => {
    // At the ceiling, notifications stop reaching EVERY member and only the
    // owner is emailed. A tech's phone just goes quiet, and from their side
    // the business had a slow afternoon. This is the signal that says
    // otherwise, on the endpoint every client already polls.
    const paused = {
      email_paused: true,
      push_paused: false,
      resets_at: "2026-07-28T07:00:00+00:00",
    };
    const sb = memberStub({ pause: paused });
    sb.on("POST", "/rest/v1/rpc/api_notifications_unread_count", () => 2);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/unread-count",
      { companyId: COMPANY_ID },
    );

    expect(await res.json()).toEqual({ count: 2, alert_pause: paused });
  });

  it("asks for the badge and the pause in one round trip each, not in series", async () => {
    // This endpoint is polled on a timer by three clients; the pause must not
    // turn one request into two sequential database calls.
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_notifications_unread_count", () => 0);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/notifications/unread-count", {
      companyId: COMPANY_ID,
    });

    expect(sb.find("POST", "/rest/v1/rpc/api_notifications_unread_count")).toHaveLength(1);
    expect(sb.find("POST", "/rest/v1/rpc/api_notification_pause")).toHaveLength(1);
  });
});

/**
 * #581 — the notification subsystem predates the #315 presets.
 *
 * Both halves of it were gated on `workspace.access`, the baseline capability
 * EVERY role holds, while everything they serve is conversation-derived: each
 * feed row carries `contact.name` and `contact.phone_e164`, and the missed-call
 * push titles itself `Missed call from <name>`. `bookkeeper` is exactly
 * `workspace.access` + `billing.manage` — the one preset documented as never
 * seeing a customer — so it passed. Per-number rules were no help either: a
 * workspace that has never written one resolves to UNRESTRICTED, which is the
 * default state, and the missed-call arm of the feed matches UNASSIGNED threads,
 * so it needed nobody's cooperation.
 *
 * The two halves are tested together on purpose. Refusing the feed while the
 * fan-out still put the customer's name on the same person's lock screen would
 * be a fix in name only.
 */
describe("#581 the feed is conversation data, not workspace data", () => {
  it("refuses a bookkeeper the feed, before the read that would have served it", async () => {
    const sb = memberStub({ role: "bookkeeper" });
    sb.on("POST", "/rest/v1/rpc/api_notifications", () => [NOTIF_A, NOTIF_B]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
    // The RPC is stubbed and deliberately left unused: a gate that refused the
    // RESPONSE after reading the rows would still have pulled two customers'
    // names and numbers into the Worker.
    expect(sb.find("POST", "/rest/v1/rpc/api_notifications")).toHaveLength(0);
  });

  it("refuses a bookkeeper the unread count, which is its own answer", async () => {
    // "How many customers reached this business today" is a number worth
    // withholding on its own, and it is the endpoint all three clients poll on a
    // timer — so leaving it behind would have kept the leak on a schedule.
    const sb = memberStub({ role: "bookkeeper" });
    sb.on("POST", "/rest/v1/rpc/api_notifications_unread_count", () => 4);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notifications/unread-count",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_notifications_unread_count"),
    ).toHaveLength(0);
  });

  it("still lets a bookkeeper read and save their OWN prefs", async () => {
    // The other half of the split, and the reason this is not a one-line sweep
    // of the file: where the phone rings and how loud is a per-person setting
    // that every role owns. A bookkeeper who cannot turn off their own email is
    // a role that cannot use the product.
    const sb = memberStub({ role: "bookkeeper" });
    sb.on("POST", "/rest/v1/notification_prefs", () => [
      { email_enabled: false, push_enabled: true },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const read = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      { companyId: COMPANY_ID },
    );
    expect(read.status).toBe(200);

    const saved = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { email_enabled: false, push_enabled: true },
      },
    );
    expect(saved.status).toBe(200);
  });
});

/**
 * #581, the other half: `listConversationViewers`, through the fan-out that made
 * it matter most.
 *
 * A gate on the poll is only half a fix — a bookkeeper with a registered device
 * got `Missed call from Dana Smith` pushed to them without polling anything. The
 * audience helper selected every non-deactivated membership row and filtered
 * only on number access, and both of its paths are exercised here: an unruled
 * number (the resolver answers with the whole crew) and no number at all (the
 * early return, which skipped access resolution entirely).
 *
 * Lives in this suite rather than in the missed-call one because the change is
 * the notification AUDIENCE rule; the missed-call fan-out is simply the consumer
 * that carries a customer's name into a lock screen.
 */
describe("#581 the missed-call push audience", () => {
  const TECH = "20000000-aaaa-4000-8000-000000000002";
  const BOOKKEEPER = "30000000-aaaa-4000-8000-000000000003";
  const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
  const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
  const CREW = [
    { user_id: TECH, role: "member" },
    { user_id: BOOKKEEPER, role: "bookkeeper" },
  ];

  function missedCallWorld(phoneNumberId: string | null): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        id: CONVERSATION_ID,
        // Unassigned, like every inbound miss nobody has picked up — which is
        // exactly the case the feed's missed_call arm also serves to everyone.
        assigned_user_id: null,
        phone_number_id: phoneNumberId,
        contacts: { name: "Dana Smith", phone_e164: "+16135551000" },
      },
    ]);
    sb.on("GET", "/rest/v1/company_members", () => CREW);
    // An UNRULED number: the resolver answers with the whole crew at full use.
    // That is the default state of every workspace that has never written an
    // access rule, and the reason #106 could not be the thing keeping a
    // bookkeeper out. Derived from the same CREW the member query answers with,
    // so the fixture cannot describe two different crews (missed-call.test.ts
    // idiom).
    sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
      CREW.map((member) => ({ ...member, level: "text" })),
    );
    // #244 reads the workspace clock only when the audience is more than one
    // person — which it IS while the bug is present. Answering "no row" keeps
    // this test about the capability filter instead of about business hours, and
    // an unstubbed read here would have failed the pre-fix run with a network
    // error instead of the assertion below.
    sb.on("GET", "/rest/v1/companies", (call) =>
      call.url.searchParams.get("select")?.startsWith("timezone,business_hours")
        ? []
        : undefined,
    );
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    return sb;
  }

  const INPUT = {
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    callerE164: "+16135551000",
    textStatus: "sent",
  } as const;

  it("wakes the tech and not the bookkeeper", async () => {
    const sb = missedCallWorld(NUMBER_ID);
    stubFetch(sb.route);

    await notifyMissedCall(env, INPUT);

    // Observed where the fan-out reads its targets (D45: there is no email leg
    // for a miss). This list IS the set of lock screens the title `Missed call
    // from Dana Smith` reaches.
    const lookup = sb.find("GET", "/rest/v1/push_subscriptions")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`in.(${TECH})`);
  });

  it("holds for a thread with no number, where there was no filter at all", async () => {
    const sb = missedCallWorld(null);
    stubFetch(sb.route);

    await notifyMissedCall(env, INPUT);

    const lookup = sb.find("GET", "/rest/v1/push_subscriptions")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`in.(${TECH})`);
    // And access resolution never ran, which is what made this path the wider
    // hole of the two.
    expect(
      sb.find("POST", "/rest/v1/rpc/number_member_levels"),
    ).toHaveLength(0);
  });
});

/**
 * #244 — a member's own quiet hours, over the wire.
 *
 * The pairing rule is the one worth guarding: half a window is not a window,
 * and a row with a start and no end would silence a phone until somebody
 * noticed it had gone quiet — which is not a thing people notice.
 */
describe("#244 quiet hours on the prefs route", () => {
  const WINDOW = {
    email_enabled: true,
    push_enabled: true,
    quiet_from: "22:00",
    quiet_to: "07:00",
    quiet_timezone: "America/Toronto",
  };

  async function put(body: Record<string, unknown>): Promise<Response> {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("POST", "/rest/v1/notification_prefs", () => [
      { email_enabled: true, push_enabled: true },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(app, env, await auth.token(), "/v1/notification-prefs", {
      companyId: COMPANY_ID,
      method: "PUT",
      body,
    });
  }

  it("QP-1: saves a window", async () => {
    expect((await put(WINDOW)).status).toBe(200);
  });

  it("QP-2: refuses half a window", async () => {
    // Both directions: a start with no end would silence the phone forever,
    // and an end with no start is a window nothing can compute.
    expect((await put({ ...WINDOW, quiet_to: null })).status).toBe(422);
    expect((await put({ ...WINDOW, quiet_from: null })).status).toBe(422);
  });

  it("QP-3: accepts no window at all, which clears it", async () => {
    expect(
      (await put({ ...WINDOW, quiet_from: null, quiet_to: null })).status,
    ).toBe(200);
  });

  it("QP-4: refuses anything that is not a wall clock", async () => {
    // "10pm" and "25:00" both reach the DB as a time cast failure, i.e. a 500
    // on a form somebody is filling in.
    expect((await put({ ...WINDOW, quiet_from: "10pm" })).status).toBe(422);
    expect((await put({ ...WINDOW, quiet_from: "25:00" })).status).toBe(422);
  });

  it("QP-5: writes all three, so saving can CLEAR a window", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("POST", "/rest/v1/notification_prefs", () => [
      { email_enabled: true, push_enabled: true },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/notification-prefs", {
      companyId: COMPANY_ID,
      method: "PUT",
      body: { email_enabled: true, push_enabled: true },
    });

    // Omitting the fields means "no window", not "leave whatever is there" —
    // otherwise turning quiet hours off would be impossible.
    const write = sb.calls.find(
      (call) =>
        call.method === "POST" && call.path === "/rest/v1/notification_prefs",
    );
    expect(write?.body).toMatchObject({
      quiet_from: null,
      quiet_to: null,
      quiet_timezone: null,
    });
  });
});

/**
 * #297 — the volume controls, over the wire.
 *
 * The rule worth guarding is that an omitted field CLEARS. It reads as
 * dangerous and is the opposite: without it, turning a category back to
 * immediate would be impossible to express, and a member who quietened
 * something once could never undo it.
 */
describe("#297 delivery preferences on the prefs route", () => {
  const BASE = { email_enabled: true, push_enabled: true };

  async function put(body: Record<string, unknown>) {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("POST", "/rest/v1/notification_prefs", () => [BASE]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/notification-prefs",
      { companyId: COMPANY_ID, method: "PUT", body },
    );
    return { res, sb };
  }

  it("DP-1: saves a per-category mode", async () => {
    const { res, sb } = await put({
      ...BASE,
      delivery: { messages_all: "batched", voicemails: "summary" },
      batch_window_minutes: 30,
    });

    expect(res.status).toBe(200);
    const write = sb.calls.find(
      (call) =>
        call.method === "POST" && call.path === "/rest/v1/notification_prefs",
    );
    expect(write?.body).toMatchObject({
      delivery: { messages_all: "batched", voicemails: "summary" },
      batch_window_minutes: 30,
    });
  });

  it("DP-2: refuses a category or a mode it has never heard of", async () => {
    // A typo here would be stored and then read back by `decideDelivery`,
    // which SENDS on anything unknown — so the member would quietly get the
    // opposite of what they picked, with nothing to show for it.
    expect(
      (await put({ ...BASE, delivery: { made_up: "batched" } })).res.status,
    ).toBe(422);
    expect(
      (await put({ ...BASE, delivery: { messages_all: "whisper" } })).res.status,
    ).toBe(422);
  });

  it("DP-3: bounds the batch window", async () => {
    // A day-long "batch" is a summary with the wrong name; a zero-minute one is
    // immediate delivery pretending to be something else.
    expect(
      (await put({ ...BASE, batch_window_minutes: 1440 })).res.status,
    ).toBe(422);
    expect((await put({ ...BASE, batch_window_minutes: 1 })).res.status).toBe(
      422,
    );
  });

  it("DP-4: an omitted field CLEARS, so a member can undo a choice", async () => {
    const { sb } = await put(BASE);

    const write = sb.calls.find(
      (call) =>
        call.method === "POST" && call.path === "/rest/v1/notification_prefs",
    );
    expect(write?.body).toMatchObject({
      delivery: {},
      batch_window_minutes: null,
      summary_at: null,
    });
  });

  it("DP-5: the summary time is a wall clock or nothing", async () => {
    expect((await put({ ...BASE, summary_at: "07:30" })).res.status).toBe(200);
    expect((await put({ ...BASE, summary_at: null })).res.status).toBe(200);
    expect((await put({ ...BASE, summary_at: "half seven" })).res.status).toBe(
      422,
    );
  });
});
