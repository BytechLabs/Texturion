/**
 * Team routes (SPEC §7, §10): members list, role changes (owner immutable),
 * deactivation, invites with the seat formula enforced at creation AND
 * acceptance, email-match rule on accept.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  countResponse,
  membershipResponder,
  pgError,
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
import { teamRoutes } from "./team";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TARGET_MEMBER_ID = "eeeeeeee-1111-4222-8333-444444444444";
const INVITE_ID = "ffffffff-1111-4222-8333-444444444444";
const FUTURE = "2027-01-01T00:00:00+00:00";

let auth: TestAuth;
const app = buildTestApp(teamRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string | null): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

/** Register plan + seat-count responders (HEAD count queries). */
function seatStub(
  sb: SupabaseStub,
  plan: string | null,
  activeMembers: number,
  pendingInvites: number,
): void {
  sb.on("GET", "/rest/v1/companies", () => [{ plan }]);
  sb.on("HEAD", "/rest/v1/company_members", () => countResponse(activeMembers));
  sb.on("HEAD", "/rest/v1/invites", () => countResponse(pendingInvites));
}

function pendingInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    company_id: COMPANY_ID,
    email: "new@crew.example",
    role: "member",
    invited_by: auth.subject,
    expires_at: FUTURE,
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-07-01T00:00:00+00:00",
    ...overrides,
  };
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: auth.subject,
    aud: "authenticated",
    email: "new@crew.example",
    email_confirmed_at: "2026-07-01T00:00:00+00:00",
    created_at: "2026-07-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("GET /v1/members", () => {
  it("merges profiles into the member list for any member", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("select")?.includes("deactivated_at")
        ? [
            {
              id: MEMBER_ID,
              user_id: auth.subject,
              role: "owner",
              deactivated_at: null,
              created_at: "2026-06-01T00:00:00+00:00",
            },
          ]
        : undefined,
    );
    sb.on("GET", "/rest/v1/profiles", () => [
      { user_id: auth.subject, display_name: "Casey" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/members", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        expect.objectContaining({
          id: MEMBER_ID,
          user_id: auth.subject,
          role: "owner",
          display_name: "Casey",
        }),
      ],
      next_cursor: null,
    });
  });
});

describe("POST /v1/invites (O/A + seat formula)", () => {
  it("403s a plain member", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "member" },
    });
    expect(res.status).toBe(403);
  });

  it("409s when active members + pending invites would exceed plan seats", async () => {
    // Starter = 3 seats; 2 active + 1 pending = full (a 4th would exceed).
    const sb = stubWithRole("owner");
    seatStub(sb, "starter", 2, 1);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "fourth@crew.example", role: "member" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "conflict", message: expect.stringContaining("Seat limit") },
    });
    expect(sb.find("POST", "/rest/v1/invites")).toHaveLength(0);
  });

  it("409s at the Pro seat cap (15); unlimited is the Enterprise tier, not Pro", async () => {
    // Pro = 15 seats; 14 active + 1 pending = full (a 16th would exceed).
    const sb = stubWithRole("owner");
    seatStub(sb, "pro", 14, 1);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "sixteenth@crew.example", role: "member" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "conflict", message: expect.stringContaining("15 seats") },
    });
    expect(sb.find("POST", "/rest/v1/invites")).toHaveLength(0);
  });

  it("creates the invite and sends the Supabase admin invite email", async () => {
    const sb = stubWithRole("admin");
    seatStub(sb, "starter", 2, 0);
    sb.on("POST", "/rest/v1/invites", (call) => [
      pendingInvite(call.body as Record<string, unknown>),
    ]);
    sb.on("POST", "/auth/v1/invite", () => authUser());
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "member" },
    });
    expect(res.status).toBe(201);

    const insert = sb.find("POST", "/rest/v1/invites")[0];
    expect(insert.body).toEqual({
      company_id: COMPANY_ID,
      email: "new@crew.example",
      role: "member",
      invited_by: auth.subject,
    });
    const email = sb.find("POST", "/auth/v1/invite")[0];
    expect(email.body).toMatchObject({ email: "new@crew.example" });
    // The redirect carries the invite id the accept screen posts back.
    expect(email.url.searchParams.get("redirect_to")).toBe(
      `${env.APP_ORIGIN}/invites/accept?invite_id=${INVITE_ID}`,
    );

    // The pending-invite count only counted unexpired pending rows.
    const inviteCount = sb.find("HEAD", "/rest/v1/invites")[0];
    expect(inviteCount.url.searchParams.get("accepted_at")).toBe("is.null");
    expect(inviteCount.url.searchParams.get("revoked_at")).toBe("is.null");
    expect(inviteCount.url.searchParams.get("expires_at")).toMatch(/^gt\./);
  });

  it("keeps the invite when the email is already a registered Auth user", async () => {
    const sb = stubWithRole("owner");
    seatStub(sb, "pro", 4, 0);
    sb.on("POST", "/rest/v1/invites", () => [pendingInvite()]);
    sb.on("POST", "/auth/v1/invite", () =>
      Response.json(
        {
          code: 422,
          error_code: "email_exists",
          msg: "A user with this email address has already been registered",
        },
        { status: 422 },
      ),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "admin" },
    });
    expect(res.status).toBe(201);
    expect(sb.find("DELETE", "/rest/v1/invites")).toHaveLength(0);
  });

  it("rolls the invite row back when the email send fails outright", async () => {
    const sb = stubWithRole("owner");
    seatStub(sb, "starter", 1, 0);
    sb.on("POST", "/rest/v1/invites", () => [pendingInvite()]);
    sb.on("POST", "/auth/v1/invite", () =>
      Response.json(
        { code: 500, error_code: "unexpected_failure", msg: "smtp down" },
        { status: 500 },
      ),
    );
    sb.on("DELETE", "/rest/v1/invites", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "member" },
    });
    expect(res.status).toBe(500);
    const rollback = sb.find("DELETE", "/rest/v1/invites")[0];
    expect(rollback.url.searchParams.get("id")).toBe(`eq.${INVITE_ID}`);
  });

  it("409s a duplicate pending invite; 422s owner role and bad email", async () => {
    const sb = stubWithRole("owner");
    seatStub(sb, "starter", 1, 0);
    sb.on("POST", "/rest/v1/invites", () => pgError("23505", "invites_pending_uq"));
    stubFetch(jwksRoute(auth), sb.route);

    const dup = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "member" },
    });
    expect(dup.status).toBe(409);

    for (const body of [
      { email: "new@crew.example", role: "owner" },
      { email: "not-an-email", role: "member" },
    ]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
        method: "POST",
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("POST /v1/invites/accept (company-exempt)", () => {
  function acceptStub(
    invite: Record<string, unknown> | null,
    user: Record<string, unknown>,
    seats: { plan: string | null; active: number; pending: number },
  ): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/invites", () => (invite ? [invite] : []));
    sb.on(
      "GET",
      new RegExp(`^/auth/v1/admin/users/${auth.subject}$`),
      () => user,
    );
    sb.on("GET", "/rest/v1/companies", () => [{ plan: seats.plan }]);
    sb.on("HEAD", "/rest/v1/company_members", () => countResponse(seats.active));
    sb.on("HEAD", "/rest/v1/invites", () => countResponse(seats.pending));
    return sb;
  }

  it("creates the membership + notification_prefs, stamps accepted_at", async () => {
    const sb = acceptStub(pendingInvite(), authUser(), {
      plan: "starter",
      active: 2,
      pending: 1, // this invite itself
    });
    sb.on("POST", "/rest/v1/company_members", (call) => [
      {
        id: TARGET_MEMBER_ID,
        ...(call.body as Record<string, unknown>),
        deactivated_at: null,
        created_at: "2026-07-01T00:00:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/notification_prefs", () => new Response(null, { status: 201 }));
    sb.on("PATCH", "/rest/v1/invites", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/invites/accept",
      { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      company_id: COMPANY_ID,
      user_id: auth.subject,
      role: "member",
    });

    expect(sb.find("POST", "/rest/v1/company_members")[0].body).toEqual({
      company_id: COMPANY_ID,
      user_id: auth.subject,
      role: "member",
    });
    // notification_prefs row, defaults true/true (SPEC §7).
    expect(sb.find("POST", "/rest/v1/notification_prefs")[0].body).toEqual({
      user_id: auth.subject,
      company_id: COMPANY_ID,
      email_enabled: true,
      push_enabled: true,
    });
    const stamp = sb.find("PATCH", "/rest/v1/invites")[0];
    expect(
      typeof (stamp.body as Record<string, unknown>).accepted_at,
    ).toBe("string");
  });

  it("re-checks the seat formula at acceptance (409 when members grew meanwhile)", async () => {
    // Starter = 3 seats. 3 active + this pending invite → 4 > 3 → 409.
    const sb = acceptStub(pendingInvite(), authUser(), {
      plan: "starter",
      active: 3,
      pending: 1,
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/invites/accept",
      { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
    );
    expect(res.status).toBe(409);
    expect(sb.find("POST", "/rest/v1/company_members")).toHaveLength(0);
  });

  it("403s when the JWT's verified email does not match the invite", async () => {
    const cases = [
      authUser({ email: "someone-else@crew.example" }),
      authUser({ email_confirmed_at: null }),
    ];
    for (const user of cases) {
      const sb = acceptStub(pendingInvite(), user, {
        plan: "starter",
        active: 1,
        pending: 1,
      });
      stubFetch(jwksRoute(auth), sb.route);
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/invites/accept",
        { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
      );
      expect(res.status).toBe(403);
      vi.unstubAllGlobals();
    }
  });

  it("matches emails case-insensitively", async () => {
    const sb = acceptStub(
      pendingInvite({ email: "New@Crew.example" }),
      authUser({ email: "new@crew.EXAMPLE" }),
      { plan: "starter", active: 1, pending: 1 },
    );
    sb.on("POST", "/rest/v1/company_members", () => [
      { id: TARGET_MEMBER_ID, user_id: auth.subject, role: "member" },
    ]);
    sb.on("POST", "/rest/v1/notification_prefs", () => new Response(null, { status: 201 }));
    sb.on("PATCH", "/rest/v1/invites", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/invites/accept",
      { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
    );
    expect(res.status).toBe(201);
  });

  it("409s revoked, expired, and already-accepted invites; 404s unknown; 409s an existing membership", async () => {
    const cases: [Record<string, unknown> | null, number][] = [
      [pendingInvite({ revoked_at: FUTURE }), 409],
      [pendingInvite({ accepted_at: FUTURE }), 409],
      [pendingInvite({ expires_at: "2026-01-01T00:00:00+00:00" }), 409],
      [null, 404],
    ];
    for (const [invite, expected] of cases) {
      const sb = acceptStub(invite, authUser(), {
        plan: "starter",
        active: 1,
        pending: 1,
      });
      stubFetch(jwksRoute(auth), sb.route);
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/invites/accept",
        { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
      );
      expect(res.status, JSON.stringify(invite)).toBe(expected);
      vi.unstubAllGlobals();
    }

    const sb = acceptStub(pendingInvite(), authUser(), {
      plan: "starter",
      active: 1,
      pending: 1,
    });
    sb.on("POST", "/rest/v1/company_members", () =>
      pgError("23505", "company_members_company_id_user_id_key"),
    );
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/invites/accept",
      { method: "POST", companyId: null, body: { invite_id: INVITE_ID } },
    );
    expect(res.status).toBe(409);
  });
});

describe("PATCH /v1/members/:id (O/A; owner immutable)", () => {
  it("403s a plain member; changes a role as admin", async () => {
    const forbidden = stubWithRole("member");
    stubFetch(jwksRoute(auth), forbidden.route);
    const denied = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { role: "admin" } },
    );
    expect(denied.status).toBe(403);
    vi.unstubAllGlobals();

    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}`
        ? [{ id: TARGET_MEMBER_ID, role: "member" }]
        : undefined,
    );
    sb.on("PATCH", "/rest/v1/company_members", (call) => [
      { id: TARGET_MEMBER_ID, ...(call.body as Record<string, unknown>) },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { role: "admin" } },
    );
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/company_members")[0].body).toEqual({
      role: "admin",
    });
  });

  it("409s any change to the owner row; 422s role 'owner' in the body", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}`
        ? [{ id: TARGET_MEMBER_ID, role: "owner" }]
        : undefined,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const immutable = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { role: "member" } },
    );
    expect(immutable.status).toBe(409);

    const assignOwner = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { role: "owner" } },
    );
    expect(assignOwner.status).toBe(422);
  });
});

describe("DELETE /v1/members/:id (deactivate, not delete)", () => {
  it("sets deactivated_at (never row-deletes); owner cannot be deactivated", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}`
        ? [{ id: TARGET_MEMBER_ID, role: "member", deactivated_at: null }]
        : undefined,
    );
    sb.on("PATCH", "/rest/v1/company_members", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const patch = sb.find("PATCH", "/rest/v1/company_members")[0];
    expect(
      typeof (patch.body as Record<string, unknown>).deactivated_at,
    ).toBe("string");
    expect(sb.find("DELETE", "/rest/v1/company_members")).toHaveLength(0);

    vi.unstubAllGlobals();
    const sb2 = stubWithRole("admin");
    sb2.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}`
        ? [{ id: TARGET_MEMBER_ID, role: "owner", deactivated_at: null }]
        : undefined,
    );
    stubFetch(jwksRoute(auth), sb2.route);
    const owner = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(owner.status).toBe(409);
  });
});

describe("GET /v1/invites + DELETE /v1/invites/:id (O/A)", () => {
  it("403s members on both; lists and revokes for admins", async () => {
    const denied = stubWithRole("member");
    stubFetch(jwksRoute(auth), denied.route);
    expect(
      (
        await apiRequest(app, env, await auth.token(), "/v1/invites", {
          companyId: COMPANY_ID,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await apiRequest(
          app,
          env,
          await auth.token(),
          `/v1/invites/${INVITE_ID}`,
          { method: "DELETE", companyId: COMPANY_ID },
        )
      ).status,
    ).toBe(403);
    vi.unstubAllGlobals();

    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/invites", () => [pendingInvite()]);
    sb.on("PATCH", "/rest/v1/invites", () => [{ id: INVITE_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const list = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      companyId: COMPANY_ID,
    });
    expect(list.status).toBe(200);

    const revoke = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/invites/${INVITE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(revoke.status).toBe(204);
    const patch = sb.find("PATCH", "/rest/v1/invites")[0];
    expect(typeof (patch.body as Record<string, unknown>).revoked_at).toBe(
      "string",
    );
    // Revoke only touches pending invites.
    expect(patch.url.searchParams.get("accepted_at")).toBe("is.null");
  });
});
