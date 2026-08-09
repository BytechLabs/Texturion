/**
 * #236 — the signed-in-devices surface. Real product code over the stubbed
 * network edge (D13): the self list and its `current` marker, the two ways to
 * sign a device out, the workspace view's role gate and its narrower shape,
 * and the two refusals that keep the feature from being a foot-gun (signing
 * out the browser you are holding; an admin signing out the owner).
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
import { sessionsRoutes } from "./sessions";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const OTHER_MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b60";
const OTHER_USER_ID = "5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c10";
const OTHER_SESSION = "9f8e7d6c-5b4a-4392-8172-6051403f2e1d";

let auth: TestAuth;
const app = buildTestApp(sessionsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: OTHER_SESSION,
    user_id: auth.subject,
    client: "android",
    user_agent: "okhttp/4.12.0",
    ip_country: "CA",
    ip_region: "Ontario",
    ip_city: "Toronto",
    first_seen_at: "2026-07-01T09:00:00+00:00",
    last_seen_at: "2026-07-28T18:22:00+00:00",
    signed_in_at: "2026-07-01T08:59:00+00:00",
    ...overrides,
  };
}

function stub(rows: unknown[], role = "member"): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  sb.on("POST", "/rest/v1/rpc/api_list_user_sessions", () => rows);
  return sb;
}

describe("GET /v1/sessions — your own devices", () => {
  it("lists them newest-active-first, with a location and no raw IP", async () => {
    const sb = stub([sessionRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/sessions", {
      companyId: null, // bearer-only: sessions belong to the person
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          id: OTHER_SESSION,
          client: "android",
          user_agent: "okhttp/4.12.0",
          location: "Toronto, Ontario, CA",
          signed_in_at: "2026-07-01T08:59:00+00:00",
          last_active_at: "2026-07-28T18:22:00+00:00",
          // The token this test presents carries a different session id, so
          // the Android phone is somebody else's device, not this browser.
          current: false,
        },
      ],
      next_cursor: null,
    });

    // Scoped to the caller's own sub — a person cannot ask for anyone else's.
    const call = sb.find("POST", "/rest/v1/rpc/api_list_user_sessions")[0];
    expect(call.body).toEqual({ p_user_ids: [auth.subject] });
  });

  it("marks the session the request itself is on", async () => {
    const token = await auth.token();
    const sessionId = auth.sessionId;
    const sb = stub([sessionRow({ session_id: sessionId, client: "web" })]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, token, "/v1/sessions", {
      companyId: null,
    });
    const body = (await res.json()) as { data: { current: boolean }[] };
    expect(body.data[0].current).toBe(true);
  });

  it("reports no location rather than a partial one when geo is unknown", async () => {
    const sb = stub([
      sessionRow({ ip_country: null, ip_region: null, ip_city: null }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/sessions", {
      companyId: null,
    });
    const body = (await res.json()) as { data: { location: null }[] };
    expect(body.data[0].location).toBeNull();
  });
});

describe("#573 signing out stops the softphone", () => {
  it("deletes the Telnyx credential the revocation orphaned", async () => {
    // The gap: the session, the push token and the refresh tokens all went, and
    // the telephony credential did not. It has no expiry, and the login token
    // minted from it stays valid — so a handset that had already registered kept
    // ringing and could answer a customer as the business after being signed out.
    // Deleting the row is not enough; the credential has to die AT Telnyx.
    const sb = stub([]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 1,
      devices: 1,
      voice_credentials: ["cred-abc", "cred-def"],
    }));
    const deleted: string[] = [];
    // A FetchRoute is a function `(url, request) => Response | undefined`, not an
    // object. Getting that wrong is invisible here: the throw lands in revoke()'s
    // best-effort catch and the count stays 0, which reads as "the code did not
    // call Telnyx" rather than "the stub was the wrong shape".
    stubFetch(jwksRoute(auth), sb.route, (url, request) => {
      if (!url.pathname.startsWith("/v2/telephony_credentials/")) return undefined;
      if (request.method === "DELETE") {
        deleted.push(url.pathname.split("/").pop() ?? "");
      }
      return Response.json({ data: {} });
    });

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/sessions/revoke",
      { method: "POST", companyId: null, body: { session_id: OTHER_SESSION } },
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual(["cred-abc", "cred-def"]);
    expect(await res.json()).toEqual({ sessions: 1, devices: 1, voice: 2 });
  });

  it("still signs the device out when Telnyx refuses", async () => {
    // A Telnyx outage must not make a sign-out fail. The session, the push token
    // and the refresh tokens are already gone by this point, so the account is far
    // better off than before — and the credential that survived is logged with its
    // id rather than counted, because it means a device that can still ring.
    const sb = stub([]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 1,
      devices: 1,
      voice_credentials: ["cred-doomed"],
    }));
    stubFetch(jwksRoute(auth), sb.route, (url) =>
      url.pathname.startsWith("/v2/telephony_credentials/")
        ? new Response("upstream is down", { status: 503 })
        : undefined,
    );

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/sessions/revoke",
      { method: "POST", companyId: null, body: { session_id: OTHER_SESSION } },
    );

    expect(res.status).toBe(200);
    // Zero deleted, and the sign-out still happened.
    expect(await res.json()).toEqual({ sessions: 1, devices: 1, voice: 0 });
  });
});

describe("POST /v1/sessions/revoke", () => {
  it("signs one device out and reports what it took with it", async () => {
    const sb = stub([]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 1,
      devices: 1,
      // #573: no softphone credential existed for this member, so nothing to
      // delete at Telnyx — the common case for somebody who never made a call.
      voice_credentials: [],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/sessions/revoke",
      { method: "POST", companyId: null, body: { session_id: OTHER_SESSION } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: 1, devices: 1, voice: 0 });

    // Scoped to the caller and to exactly the session they named.
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")[0].body).toEqual({
      p_user_id: auth.subject,
      p_session_ids: [OTHER_SESSION],
      p_except: null,
      p_actor: auth.subject,
      p_reason: "self",
    });
  });

  it("signs out everywhere EXCEPT the device asking", async () => {
    const token = await auth.token();
    const sessionId = auth.sessionId;
    const sb = stub([]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 3,
      devices: 4,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, token, "/v1/sessions/revoke", {
      method: "POST",
      companyId: null,
      body: { others: true },
    });
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")[0].body).toEqual({
      p_user_id: auth.subject,
      p_session_ids: null,
      p_except: sessionId,
      p_actor: auth.subject,
      p_reason: "sign_out_all",
    });
  });

  it("refuses to sign out the device making the request", async () => {
    const token = await auth.token();
    const sessionId = auth.sessionId;
    const sb = stub([]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, token, "/v1/sessions/revoke", {
      method: "POST",
      companyId: null,
      body: { session_id: sessionId },
    });
    // 409, and nothing was revoked: signing yourself out from inside the list
    // would 401 the very response reporting it.
    expect(res.status).toBe(409);
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")).toHaveLength(0);
  });

  it("404s a session id that is not the caller's", async () => {
    const sb = stub([]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 0,
      devices: 0,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/sessions/revoke",
      { method: "POST", companyId: null, body: { session_id: OTHER_SESSION } },
    );
    expect(res.status).toBe(404);
  });

  it("422s a body that names neither a session nor everything else", async () => {
    const sb = stub([]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/sessions/revoke",
      { method: "POST", companyId: null, body: {} },
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /v1/members/sessions — the workspace view", () => {
  it("is admin-and-up only", async () => {
    const sb = stub([], "member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/members/sessions",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
  });

  it("shows every active member's devices, and nothing an owner has no business reading", async () => {
    const sb = stub(
      [sessionRow({ user_id: OTHER_USER_ID, client: "ios" })],
      "owner",
    );
    sb.on("GET", "/rest/v1/company_members", () => [
      { id: MEMBER_ID, user_id: auth.subject },
      { id: OTHER_MEMBER_ID, user_id: OTHER_USER_ID },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/members/sessions",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          id: OTHER_SESSION,
          member_id: OTHER_MEMBER_ID,
          client: "ios",
          location: "Toronto, Ontario, CA",
          signed_in_at: "2026-07-01T08:59:00+00:00",
          last_active_at: "2026-07-28T18:22:00+00:00",
        },
      ],
      next_cursor: null,
    });
    // The member lookup is scoped to this workspace's ACTIVE members only.
    const members = sb.find("GET", "/rest/v1/company_members")[0];
    expect(members.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(members.url.searchParams.get("deactivated_at")).toBe("is.null");
  });
});

describe("POST /v1/members/:id/sessions/revoke", () => {
  function revokeStub(role: string, target: { user_id: string; role: string }) {
    const sb = stub([], role);
    sb.on("GET", "/rest/v1/company_members", () => [target]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
      sessions: 2,
      devices: 3,
      voice_credentials: [],
    }));
    sb.on("POST", "/rest/v1/audit_log", () => []);
    return sb;
  }

  it("signs a departed tech out everywhere and records it", async () => {
    const sb = revokeStub("admin", { user_id: OTHER_USER_ID, role: "member" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${OTHER_MEMBER_ID}/sessions/revoke`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: 2, devices: 3, voice: 0 });

    // Every session of theirs, with no exception — the point is that the
    // person is gone.
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")[0].body).toEqual({
      p_user_id: OTHER_USER_ID,
      p_session_ids: null,
      p_except: null,
      p_actor: auth.subject,
      p_reason: "admin",
    });
    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    expect(audit.body).toMatchObject({
      action: "member.sessions_revoked",
      target_type: "member",
      target_id: OTHER_MEMBER_ID,
      after: { sessions_ended: 2, push_devices_removed: 3 },
    });
  });

  it("refuses an admin signing the OWNER out of their own business", async () => {
    const sb = revokeStub("admin", { user_id: OTHER_USER_ID, role: "owner" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${OTHER_MEMBER_ID}/sessions/revoke`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")).toHaveLength(0);
  });

  it("lets an owner clear their own other devices without locking themselves out", async () => {
    const token = await auth.token();
    const sessionId = auth.sessionId;
    const sb = revokeStub("owner", { user_id: auth.subject, role: "owner" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      token,
      `/v1/members/${MEMBER_ID}/sessions/revoke`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(200);
    expect(
      (sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")[0].body as {
        p_except: string;
      }).p_except,
    ).toBe(sessionId);
  });

  it("404s a member id from another workspace", async () => {
    const sb = stub([], "owner");
    sb.on("GET", "/rest/v1/company_members", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${OTHER_MEMBER_ID}/sessions/revoke`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(404);
  });
});
