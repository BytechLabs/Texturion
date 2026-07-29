import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEMBER_ROLES, type AppEnv, type MemberRole } from "../context";
import {
  authorizeRoute,
  completeEnv,
  stubFetch,
  type CapturedRequest,
} from "../test/support";
import { COMPANY_EXEMPT_ROUTES, companyContext, requireRole } from "./company";

const env = completeEnv();
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

// Probe app: userId is planted by test wiring (the JWT middleware owns that in
// production — its own suite covers it); companyContext is the REAL middleware
// and its PostgREST lookup goes through the stubbed network edge.
const SESSION_ID = "3c7a1e52-9d40-4b18-8a6f-2b5c4d3e1f00";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("userId", USER_ID);
  c.set("sessionId", SESSION_ID);
  // Password alone unless a test says otherwise — the conservative default,
  // and the one the enforcement gate is about.
  c.set("aal", "aal1");
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

/** The same probe, but presenting a token that carries a verified factor. */
const aal2App = new Hono<AppEnv>();
aal2App.use("*", async (c, next) => {
  c.set("userId", USER_ID);
  c.set("sessionId", SESSION_ID);
  c.set("aal", "aal2");
  await next();
});
aal2App.use("*", companyContext());
aal2App.get("/v1/probe", (c) => c.json({ role: c.get("role") }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(headers: Record<string, string> = {}) {
  return app.request("/v1/probe", { headers }, env);
}

describe("companyContext (SPEC §10: X-Company-Id validated against company_members)", () => {
  it("attaches { companyId, role, memberId } for an active member", async () => {
    const captured: CapturedRequest = {};
    stubFetch(authorizeRoute(env, { id: MEMBER_ID, role: "admin" }, { captured }));

    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      companyId: COMPANY_ID,
      role: "admin",
      memberId: MEMBER_ID,
    });

    // The lookup went over PostgREST with the sb_secret key, scoped to the
    // (company, user) pair. The membership filter itself now lives inside the
    // RPC (api_authorize_request), so what the wire has to prove is that the
    // caller's identity and the named company both travel server-side.
    expect(await captured.request!.json()).toMatchObject({
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_session_id: SESSION_ID,
    });
    expect(captured.request!.headers.get("apikey")).toBe(
      env.SUPABASE_SECRET_KEY,
    );
  });

  it("returns 403 forbidden when the user is not an active member", async () => {
    stubFetch(authorizeRoute(env, null));
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
  });

  // #236: the acceptance criterion the issue leads with — a signed-out device
  // fails its NEXT call, not its next hour.
  it("401s a session that has been signed out, on a company route", async () => {
    stubFetch(authorizeRoute(env, { id: MEMBER_ID, role: "owner" }, { revoked: true }));
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  // #314. The lockout risk is the whole design constraint here, so what these
  // pin is mostly when the gate must NOT fire.
  it("does not demand a factor while the grace window is still open", async () => {
    stubFetch(
      authorizeRoute(env, { id: MEMBER_ID, role: "member" }, {
        mfa: { required: true, grace_until: "2099-01-01T00:00:00Z", enforcing: false },
      }),
    );
    const res = await request({ "X-Company-Id": COMPANY_ID });
    // The crew keeps working. Enforcement that starts the instant it is
    // switched on is how a security feature becomes an outage mid-shift.
    expect(res.status).toBe(200);
  });

  it("403s mfa_required once the grace window has passed", async () => {
    stubFetch(
      authorizeRoute(env, { id: MEMBER_ID, role: "member" }, {
        mfa: { required: true, grace_until: "2020-01-01T00:00:00Z", enforcing: true },
      }),
    );
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(403);
    // Its own code, not a 403 with prose: all three clients route on this to
    // the enrolment screen, and a message-sniffing client would break the
    // first time somebody edited the copy.
    expect(await res.json()).toEqual({
      error: { code: "mfa_required", message: expect.any(String) },
    });
  });

  it("lets a token that HAS a second factor straight through", async () => {
    stubFetch(
      authorizeRoute(env, { id: MEMBER_ID, role: "member" }, {
        mfa: { required: true, grace_until: "2020-01-01T00:00:00Z", enforcing: true },
      }),
    );
    const res = await aal2App.request(
      "/v1/probe",
      { headers: { "X-Company-Id": COMPANY_ID } },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("reads a missing mfa field as no policy, so a Worker ahead of the migration still serves", async () => {
    // Expand/contract: the Worker can deploy before the migration lands. For
    // an auth middleware, 500ing every request in that window is the product
    // being down.
    stubFetch(authorizeRoute(env, { id: MEMBER_ID, role: "member" }));
    const res = await request({ "X-Company-Id": COMPANY_ID });
    expect(res.status).toBe(200);
  });

  it("401s a signed-out session on the company-EXEMPT routes too", async () => {
    // The exempt routes are exactly where a revoked device would otherwise
    // keep breathing: /v1/me still reads a profile, and the push-token routes
    // would keep a phone subscribed to customer messages.
    stubFetch(authorizeRoute(env, null, { revoked: true }));
    const res = await app.request("/v1/me", {}, env);
    expect(res.status).toBe(401);
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

  it("skips the COMPANY half on the exempt routes (SPEC §7: GET /v1/me needs no company header)", async () => {
    const captured: CapturedRequest = {};
    stubFetch(authorizeRoute(env, null, { captured }));
    const res = await app.request("/v1/me", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ companyId: null });
    // No company is named, so no membership is demanded — but the session
    // half still ran (#236).
    expect(await captured.request!.json()).toMatchObject({
      p_company_id: null,
      p_session_id: SESSION_ID,
    });
  });

  it("surfaces a PostgREST failure as a 500, never as an authorization result", async () => {
    // 4xx (not 5xx): supabase-js transparently retries 5xx GETs with backoff,
    // which is production-correct but would just slow this test down.
    stubFetch((url) =>
      url.pathname.startsWith("/rest/v1/rpc/api_authorize_request")
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

/**
 * #347 acceptance: "cross-tenant access is asserted to fail by test, not by
 * inspection."
 *
 * The behavioural assertion is above, once — an active-member lookup that
 * comes back empty is a 403, at the single place tenancy is decided. Repeating
 * it per route would assert the same middleware thirty-three times and prove
 * nothing extra, because no route decides this for itself.
 *
 * What is NOT proven by that, and is proven here, is that nothing can BYPASS
 * it. Three ways it could, all of them silent:
 *
 *   1. a handler reads a company id out of the request instead of the context,
 *   2. a route joins the exempt list without anyone deciding to exempt it,
 *   3. a route is mounted where the middleware does not run.
 *
 * Each would leave every existing test green.
 */
describe("#347 — nothing bypasses the company context", () => {
  const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

  function routeSources(): { path: string; source: string }[] {
    const found: { path: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
        found.push({
          path: relative(API_SRC, full).replaceAll("\\", "/"),
          source: readFileSync(full, "utf8"),
        });
      }
    };
    walk(join(API_SRC, "routes"));
    return found;
  }

  it("never takes a company id from the request", () => {
    // The middleware's whole guarantee is that the scope is derived
    // server-side from a membership lookup. A handler that read `company_id`
    // out of a body or a query string would be scoping to a company the
    // caller merely NAMED — which is a cross-tenant read with a company_id in
    // it, so the #347 scope scan would pass it happily.
    const offenders: string[] = [];
    for (const { path, source } of routeSources()) {
      const patterns: [RegExp, string][] = [
        [/company_id\s*:\s*z\./, "a company_id field in a request schema"],
        [/req\.param\(\s*["'`]company_?[Ii]d["'`]/, "a company id path param"],
        [/req\.query\(\s*["'`]company_?[Ii]d["'`]/, "a company id query param"],
        [/body\.company_?[Ii]d/, "a company id read off the request body"],
      ];
      for (const [pattern, what] of patterns) {
        if (pattern.test(source)) offenders.push(`${path}: ${what}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("pins the exempt routes, so a new one is a decision and not a slip", () => {
    // Every entry here is a route that runs with a JWT and NO company scope.
    // That is correct for all of them — they act on the caller's own person
    // rather than on a workspace — but it is exactly the list somebody would
    // append to in order to make a 422 go away.
    expect([...COMPANY_EXEMPT_ROUTES].sort()).toEqual(
      [
        "DELETE /v1/account",
        "DELETE /v1/device-push-tokens",
        "GET /v1/account/deletion-preview",
        "GET /v1/available-numbers",
        "GET /v1/invites/mine",
        "GET /v1/me",
        "PATCH /v1/me",
        "POST /v1/companies",
        "POST /v1/device-push-tokens",
        "POST /v1/invites/accept",
        "POST /v1/me/email/retry",
        "GET /v1/sessions",
        "POST /v1/sessions/revoke",
        // #314: the escape hatches. Every one of these is a route somebody
        // told "enrol in MFA" has to be able to reach, so exempting them is
        // what makes the enforcement gate safe rather than an outage.
        "GET /v1/mfa",
        "POST /v1/mfa/recovery-codes",
        "POST /v1/mfa/recover",
      ].sort(),
    );
  });

  it("registers the middleware before any /v1 route it must cover", () => {
    // Hono applies `app.use` to handlers registered AFTER it. A sub-app
    // mounted above the middleware line would answer with no company context
    // at all — and its handlers would read `c.get("companyId")` as undefined,
    // which scopes a query to nothing rather than refusing it.
    const index = readFileSync(join(API_SRC, "index.ts"), "utf8");
    const middlewareAt = index.indexOf('app.use("/v1/*", companyContext())');
    expect(middlewareAt, "companyContext() is not applied to /v1/*").toBeGreaterThan(-1);

    const firstMount = index.search(/app\.route\(\s*["'`]\/v1/);
    expect(firstMount, "no /v1 sub-app is mounted at all").toBeGreaterThan(-1);
    expect(
      middlewareAt,
      "a /v1 sub-app is mounted BEFORE companyContext() and so runs without it",
    ).toBeLessThan(firstMount);
  });
});
