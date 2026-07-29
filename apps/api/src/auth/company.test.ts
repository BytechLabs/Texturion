import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEMBER_ROLES, type AppEnv, type MemberRole } from "../context";
import {
  companyMembersRoute,
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
