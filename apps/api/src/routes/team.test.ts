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
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { teamRoutes } from "./team";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TARGET_MEMBER_ID = "eeeeeeee-1111-4222-8333-444444444444";
/** #276: where a leaver's open work is handed. */
const REASSIGN_TO = "cccccccc-1111-4222-8333-444444444444";
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
  // #231: every membership change writes one audit row.
  sb.on("POST", "/rest/v1/audit_log", () => []);
  return sb;
}

/** The one #231 row a privileged action wrote, or a failure naming the count. */
function auditRow(sb: SupabaseStub): Record<string, unknown> {
  const writes = sb.find("POST", "/rest/v1/audit_log");
  expect(writes).toHaveLength(1);
  return writes[0].body as Record<string, unknown>;
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

  it("creates the invite and sends the Supabase admin invite email (email_sent:true)", async () => {
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
    // The email went out — the UI shows the plain "Invite sent" confirmation.
    expect(await res.json()).toMatchObject({ email_sent: true });

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

  /** Capture route for the direct Resend send (#109 existing-account branch). */
  function resendCapture(status = 200) {
    const calls: Record<string, unknown>[] = [];
    const route: FetchRoute = async (url, request) => {
      if (url.href !== "https://api.resend.com/emails") return undefined;
      calls.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json(
        status === 200 ? { id: "email_1" } : { message: "smtp down" },
        { status },
      );
    };
    return { route, calls };
  }

  it("#109: an already-registered email gets a DIRECT Resend invite (email_sent:true)", async () => {
    const sb = stubWithRole("owner");
    // The companies responder carries `name` for the email copy; it also serves
    // the plan read (registered before seatStub's, so it wins).
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "pro", name: "Acme Plumbing" },
    ]);
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
    const resend = resendCapture();
    stubFetch(jwksRoute(auth), sb.route, resend.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "admin" },
    });
    expect(res.status).toBe(201);
    // GoTrue 422s an existing account and emails NOTHING — the route now sends
    // the invite itself instead of telling the inviter to hand-deliver a link.
    expect(await res.json()).toMatchObject({ email_sent: true });
    expect(sb.find("DELETE", "/rest/v1/invites")).toHaveLength(0);

    expect(resend.calls).toHaveLength(1);
    const email = resend.calls[0] as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(email.to).toEqual(["new@crew.example"]);
    expect(email.subject).toBe(
      "You've been invited to join Acme Plumbing on Loonext",
    );
    // The in-app accept link — the same page the Copy-link button shares.
    expect(email.text).toContain(`${env.APP_ORIGIN}/invite/${INVITE_ID}`);
    expect(email.html).toContain(`${env.APP_ORIGIN}/invite/${INVITE_ID}`);
  });

  it("#109: the direct send failing degrades to email_sent:false — invite kept (Copy link covers it)", async () => {
    const sb = stubWithRole("owner");
    seatStub(sb, "pro", 4, 0);
    sb.on("POST", "/rest/v1/invites", () => [pendingInvite()]);
    sb.on("POST", "/auth/v1/invite", () =>
      Response.json(
        { code: 422, error_code: "email_exists", msg: "already registered" },
        { status: 422 },
      ),
    );
    const resend = resendCapture(500);
    stubFetch(jwksRoute(auth), sb.route, resend.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { email: "new@crew.example", role: "admin" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email_sent: false });
    // NO rollback: unlike the new-user failure, the invite stays actionable
    // via Copy link.
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

describe("GET /v1/invites/mine (company-exempt, #109)", () => {
  function mineStub(
    user: Record<string, unknown>,
    invites: Record<string, unknown>[],
  ): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      new RegExp(`^/auth/v1/admin/users/${auth.subject}$`),
      () => user,
    );
    sb.on("GET", "/rest/v1/invites", () => invites);
    return sb;
  }

  it("lists the caller's pending invites, matched on the confirmed email, with the company name", async () => {
    const sb = mineStub(authUser(), [
      { ...pendingInvite(), companies: { name: "Acme Plumbing" } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    // Company-exempt: no X-Company-Id header.
    const res = await apiRequest(app, env, await auth.token(), "/v1/invites/mine", {
      companyId: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; company_name: string | null; companies?: unknown }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: INVITE_ID,
      company_id: COMPANY_ID,
      company_name: "Acme Plumbing",
    });
    // The embed is flattened — the raw join artifact never leaks.
    expect(body.data[0].companies).toBeUndefined();

    // PENDING-only + the caller's email, matched at the DB (citext).
    const q = sb.find("GET", "/rest/v1/invites")[0].url.searchParams;
    expect(q.get("email")).toBe("eq.new@crew.example");
    expect(q.get("accepted_at")).toBe("is.null");
    expect(q.get("revoked_at")).toBe("is.null");
    expect(q.get("expires_at")).toMatch(/^gt\./);
    expect(q.get("select")).toContain("companies(name)");
  });

  it("an UNCONFIRMED email matches nothing — no invites query at all", async () => {
    const sb = mineStub(authUser({ email_confirmed_at: null }), [
      { ...pendingInvite(), companies: { name: "Acme Plumbing" } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/invites/mine", {
      companyId: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    expect(sb.find("GET", "/rest/v1/invites")).toHaveLength(0);
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
    // An ACTIVE membership — deactivated_at null. This is the case the 409 is
    // for, and #383 is what happened when it was the only case considered.
    sb.on("GET", "/rest/v1/company_members", () => [
      { id: TARGET_MEMBER_ID, user_id: auth.subject, role: "member", deactivated_at: null },
    ]);
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

  it("#383: someone who was offboarded can accept a new invite and rejoin", async () => {
    // Offboarding (#276) stamps deactivated_at rather than deleting the row,
    // so the insert still collides. Refusing on the collision alone told a
    // returning crew member they were "already a member" of a workspace they
    // could not open — the bug a real user hit.
    const sb = acceptStub(pendingInvite({ role: "member" }), authUser(), {
      plan: "starter",
      active: 1,
      pending: 1,
    });
    sb.on("POST", "/rest/v1/company_members", () =>
      pgError("23505", "company_members_company_id_user_id_key"),
    );
    sb.on("GET", "/rest/v1/company_members", () => [
      {
        id: TARGET_MEMBER_ID,
        user_id: auth.subject,
        role: "admin", // what they held BEFORE they left
        deactivated_at: "2026-07-01T00:00:00+00:00",
      },
    ]);
    let patched: Record<string, unknown> | null = null;
    sb.on("PATCH", "/rest/v1/company_members", (call) => {
      patched = call.body as Record<string, unknown>;
      return [
        {
          id: TARGET_MEMBER_ID,
          user_id: auth.subject,
          role: "member",
          deactivated_at: null,
          created_at: "2026-07-01T00:00:00+00:00",
        },
      ];
    });
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
    // The mark is cleared, and the role comes from THIS invite — a returning
    // admin does not silently regain admin because they once had it.
    expect(patched).toMatchObject({ deactivated_at: null, role: "member" });
    expect(await res.json()).toMatchObject({ deactivated_at: null });
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
    // #231: who can do what is the first thing reconstructed after an incident,
    // so the row carries both sides of the change.
    expect(auditRow(sb)).toMatchObject({
      action: "member.role_changed",
      target_type: "member",
      target_id: TARGET_MEMBER_ID,
      before: { role: "member" },
      after: { role: "admin" },
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

describe("DELETE /v1/members/:id (offboard, not delete)", () => {
  /** The stubs an offboarding needs: the RPC, the softphone, and the cleanups. */
  function offboardStub(
    outcome: Record<string, unknown> = {
      outcome: "deactivated",
      user_id: "u-target",
      conversations: 2,
      tasks: 3,
    },
  ): SupabaseStub {
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/rpc/offboard_member", () => outcome);
    // D43 (#135): deactivation revokes the softphone — no credential row here.
    sb.on("GET", "/rest/v1/member_telephony_credentials", () => []);
    sb.on("POST", "/rest/v1/rpc/api_revoke_user_sessions", () => 2);
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => [{ id: "s-1" }]);
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => [
      { id: "d-1" },
      { id: "d-2" },
    ]);
    return sb;
  }

  it("hands the work on, ends access, and never row-deletes the member", async () => {
    const sb = offboardStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}?reassign_to=${REASSIGN_TO}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversations_moved: 2,
      tasks_moved: 3,
      sessions_ended: 2,
      push_devices_removed: 3,
    });

    // #276: deactivate + reassign are ONE transaction. A crash between them is
    // exactly how work ended up pointing at people who had gone.
    const rpc = sb.find("POST", "/rest/v1/rpc/offboard_member")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_member_id: TARGET_MEMBER_ID,
      p_reassign_to: REASSIGN_TO,
    });
    // The membership row is never deleted — history keeps its attribution.
    expect(sb.find("DELETE", "/rest/v1/company_members")).toHaveLength(0);

    // #236: removing someone means their access is over, not that they are
    // hidden from a list. Sessions end and push stops reaching their devices.
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_user_sessions")[0].body).toEqual({
      p_user_id: "u-target",
    });
    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(1);
    expect(sb.find("DELETE", "/rest/v1/device_push_tokens")).toHaveLength(1);

    // #231: the offboarding and everything it moved, on the record.
    expect(auditRow(sb)).toMatchObject({
      company_id: COMPANY_ID,
      action: "member.deactivated",
      target_type: "member",
      target_id: TARGET_MEMBER_ID,
      after: {
        active: false,
        reassigned_to: REASSIGN_TO,
        conversations_moved: 2,
        tasks_moved: 3,
        sessions_ended: 2,
        push_devices_removed: 3,
      },
    });
  });

  it("releases the work to the crew when no destination is named", async () => {
    // Releasing is a real choice — the crew picks it up from the shared inbox.
    // What is gone is leaving it pointing at someone who will never look.
    const sb = offboardStub();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")[0].body).toMatchObject(
      { p_reassign_to: null },
    );
    expect(auditRow(sb)).toMatchObject({ after: { reassigned_to: null } });
  });

  it("refuses a destination who is not on the team any more", async () => {
    // Handing a leaver's work to another leaver is the same hole twice.
    const sb = offboardStub({ outcome: "bad_destination" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}?reassign_to=${REASSIGN_TO}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
    // Nothing was touched: no sessions ended, no push removed.
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_user_sessions")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });

  it("409s the owner and 404s a stranger", async () => {
    const ownerStub = offboardStub({ outcome: "owner" });
    stubFetch(jwksRoute(auth), ownerStub.route);
    const owner = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(owner.status).toBe(409);

    vi.unstubAllGlobals();
    const missing = offboardStub({ outcome: "not_found" });
    stubFetch(jwksRoute(auth), missing.route);
    const gone = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(gone.status).toBe(404);
  });

  it("still completes when session or push cleanup fails", async () => {
    // The member IS deactivated by the time these run. Failing the request
    // would tell the owner the removal did not happen when it did, and every
    // step here is safely repeatable.
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/rpc/offboard_member", () => ({
      outcome: "deactivated",
      user_id: "u-target",
      conversations: 0,
      tasks: 0,
    }));
    sb.on("GET", "/rest/v1/member_telephony_credentials", () => []);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_revoke_user_sessions",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    sb.on(
      "DELETE",
      "/rest/v1/push_subscriptions",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sessions_ended: 0,
      push_devices_removed: 0,
    });
    // And the audit row says honestly that nothing was ended.
    expect(auditRow(sb)).toMatchObject({
      after: { sessions_ended: 0, push_devices_removed: 0 },
    });
  });
});

describe("GET /v1/members/:id/holdings (#276)", () => {
  it("reports the open work a member is holding", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}`
        ? [{ user_id: "u-target" }]
        : undefined,
    );
    sb.on("POST", "/rest/v1/rpc/api_member_holdings", () => ({
      conversations: 4,
      tasks: 7,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}/holdings`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversations: 4, tasks: 7 });
    expect(sb.find("POST", "/rest/v1/rpc/api_member_holdings")[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: "u-target",
    });
  });

  it("404s a member of another workspace", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("id") === `eq.${TARGET_MEMBER_ID}` ? [] : undefined,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/members/${TARGET_MEMBER_ID}/holdings`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
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

describe("DELETE /v1/members/me (#406 — leaving on your own)", () => {
  function leaveStub(role: string, opts: { deactivated?: boolean } = {}) {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", (call) => {
      // The owner-notification recipient lookup asks by ROLE, not user.
      if (call.url.searchParams.get("role")?.startsWith("in.")) {
        return [{ user_id: auth.subject }];
      }
      if (
        call.url.searchParams.get("user_id") === `eq.${auth.subject}` &&
        !opts.deactivated
      ) {
        return [{ id: TARGET_MEMBER_ID, role }];
      }
      return membershipResponder(MEMBER_ID, role)(call);
    });
    sb.on("GET", "/rest/v1/profiles", () => []);
    sb.on("POST", "/rest/v1/rpc/offboard_member", () => ({
      outcome: "deactivated",
      user_id: auth.subject,
      conversations: 2,
      tasks: 1,
    }));
    // The same cleanup surface an owner-initiated removal touches — leaving
    // has to mean the access is over, not that a name left a list (#236).
    sb.on("GET", "/rest/v1/member_telephony_credentials", () => []);
    sb.on("POST", "/rest/v1/rpc/api_revoke_user_sessions", () => 2);
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => [{ id: "s-1" }]);
    sb.on("DELETE", "/rest/v1/device_push_tokens", () => [{ id: "d-1" }]);
    sb.on("GET", /\/auth\/v1\/admin\/users\//, () => ({
      id: auth.subject,
      email: "tech@crew.example",
    }));
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    sb.on("GET", "/rest/v1/companies", () => [{ name: "Acme Plumbing" }]);
    return sb;
  }

  it("lets a member remove themselves and releases their work", async () => {
    // The whole point: the person with the strongest reason to sever the
    // connection was the only one who could not.
    const sb = leaveStub("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/members/me", {
      method: "DELETE",
      companyId: COMPANY_ID,
    });

    expect(res.status).toBe(200);
    // Released to UNASSIGNED, not handed to a name: the person leaving should
    // not be choosing who inherits, and unassigned shows up in triage rather
    // than pointing at somebody who has gone.
    const rpc = sb.find("POST", "/rest/v1/rpc/offboard_member")[0];
    expect((rpc.body as { p_reassign_to: string | null }).p_reassign_to).toBeNull();
    expect(await res.json()).toMatchObject({
      conversations_released: 2,
      tasks_released: 1,
    });
  });

  it("routes /me ahead of /:id rather than reading it as a member id", async () => {
    // The failure this guards is silent: with the routes the other way round,
    // "me" reaches the :id handler, fails to parse as a UUID, and a member
    // gets a validation error instead of leaving.
    const sb = leaveStub("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/members/me", {
      method: "DELETE",
      companyId: COMPANY_ID,
    });
    expect(res.status).not.toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")).toHaveLength(1);
  });

  it("refuses the owner, who would strand the workspace", async () => {
    // #332's problem, not this one: an owner who left would leave a workspace
    // nobody can administer.
    const sb = leaveStub("owner");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/members/me", {
      method: "DELETE",
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(409);
    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")).toHaveLength(0);
  });

  it("tells the owner somebody left", async () => {
    // A seat just freed and work just landed in triage. The owner should not
    // find that out by noticing threads going unanswered.
    const sb = leaveStub("member");
    const sent: unknown[] = [];
    const resend: FetchRoute = async (url, request) => {
      if (url.hostname !== "api.resend.com") return undefined;
      sent.push(await request.clone().json());
      return Response.json({ id: "email_1" });
    };
    stubFetch(jwksRoute(auth), sb.route, resend);

    await apiRequest(app, env, await auth.token(), "/v1/members/me", {
      method: "DELETE",
      companyId: COMPANY_ID,
    });

    expect(sent).toHaveLength(1);
    const mail = sent[0] as { subject: string; text: string };
    expect(mail.subject).toContain("has left");
    // Says what actually happened to the work, so the owner knows whether
    // anything needs picking up.
    expect(mail.text).toContain("unassigned");
  });
});
