import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEMBER_ROLES, type AppEnv, type MemberRole } from "../context";
import {
  companyMembersRoute,
  completeEnv,
  stubFetch,
  type CapturedRequest,
} from "../test/support";
import { companyContext, requireRole } from "./company";

const env = completeEnv();
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

// Probe app: userId is planted by test wiring (the JWT middleware owns that in
// production — its own suite covers it); companyContext is the REAL middleware
// and its PostgREST lookup goes through the stubbed network edge.
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("userId", USER_ID);
  await next();
});
app.use("*", companyContext());
app.get("/v1/probe", (c) =>
  c.json({
    companyId: c.get("companyId"),
    role: c.get("role"),
    memberId: c.get("memberId"),
  }),
);
app.get("/v1/me", (c) => c.json({ companyId: c.get("companyId") ?? null }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(headers: Record<string, string> = {}) {
  return app.request("/v1/probe", { headers }, env);
}

describe("companyContext (SPEC §10: X-Company-Id validated against company_members)", () => {
  it("attaches { companyId, role, memberId } for an active member", async () => {
    const captured: CapturedRequest = {};
    stubFetch(
      companyMembersRoute(env, [{ id: MEMBER_ID, role: "admin" }], captured),
    );

    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      companyId: COMPANY_ID,
      role: "admin",
      memberId: MEMBER_ID,
    });

    // The lookup went over PostgREST with the sb_secret key, scoped to the
    // (company, user) pair, and filtered to active memberships.
    const params = captured.url!.searchParams;
    expect(params.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(params.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(params.get("deactivated_at")).toBe("is.null");
    expect(params.get("select")).toBe("id,role");
    expect(captured.request!.headers.get("apikey")).toBe(
      env.SUPABASE_SECRET_KEY,
    );
  });

  it("returns 403 forbidden when the user is not an active member", async () => {
    stubFetch(companyMembersRoute(env, []));
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
  });

  it("returns 422 validation_failed for a non-UUID X-Company-Id without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await request({ "X-Company-Id": "not-a-uuid" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 422 validation_failed when the header is missing entirely", async () => {
    stubFetch();
    const res = await request();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
  });

  it("skips the exempt routes (SPEC §7: GET /v1/me needs no company header)", async () => {
    stubFetch(); // any network call would fail the test loudly
    const res = await app.request("/v1/me", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ companyId: null });
  });

  it("surfaces a PostgREST failure as a 500, never as an authorization result", async () => {
    // 4xx (not 5xx): supabase-js transparently retries 5xx GETs with backoff,
    // which is production-correct but would just slow this test down.
    stubFetch((url) =>
      url.pathname.startsWith("/rest/v1/company_members")
        ? Response.json(
            { message: "permission denied", code: "42501" },
            { status: 400 },
          )
        : undefined,
    );
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(500);
  });
});

describe("requireRole (SPEC §10 role matrix: owner ⊃ admin ⊃ member)", () => {
  function gateApp(actual: MemberRole | undefined, minimum: MemberRole) {
    const gated = new Hono<AppEnv>();
    gated.use("*", async (c, next) => {
      if (actual !== undefined) c.set("role", actual);
      await next();
    });
    gated.use("*", requireRole(minimum));
    gated.get("/action", (c) => c.json({ ok: true }));
    return gated;
  }

  const RANK: Record<MemberRole, number> = { member: 1, admin: 2, owner: 3 };

  for (const minimum of MEMBER_ROLES) {
    for (const actual of MEMBER_ROLES) {
      const allowed = RANK[actual] >= RANK[minimum];
      it(`${actual} ${allowed ? "passes" : "is refused by"} requireRole('${minimum}')`, async () => {
        const res = await gateApp(actual, minimum).request("/action", {}, env);
        if (allowed) {
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ ok: true });
        } else {
          expect(res.status).toBe(403);
          expect(await res.json()).toEqual({
            error: { code: "forbidden", message: expect.any(String) },
          });
        }
      });
    }
  }

  it("refuses when no role is attached at all (gate used without company context)", async () => {
    const res = await gateApp(undefined, "member").request("/action", {}, env);
    expect(res.status).toBe(403);
  });
});
