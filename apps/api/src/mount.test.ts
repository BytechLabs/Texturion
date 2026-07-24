/**
 * Integration tests for the mounted app (SPEC §7, §10, §11):
 * CORS → JWT → company context on /v1/*, /health outside the chain,
 * /webhooks/* mounted signature-authenticated and CORS-free, the full §7
 * route inventory, and the §11 cron map in lockstep with wrangler.jsonc.
 * Exercises the REAL exported app; only global fetch (JWKS + PostgREST) is
 * stubbed.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runGraceJob } from "./billing/grace";
import { runSubscriptionReconcileJob } from "./billing/reconcile";
import { runOverageWarningJob } from "./billing/overage-warning";
import { runUsageAlertsJob } from "./billing/usage-alerts";
import { sweepDeletedAttachments } from "./attachments/sweep";
import { geocodeContactsJob } from "./geocode/geocode-contacts";
import { app, CRON_JOBS } from "./index";
import {
  failStuckOutboundSends,
  reportUnreportedUsage,
  reportUnreportedVoiceUsage,
  sweepStaleCalls,
  sweepWebhookEvents,
} from "./messaging/crons";
import { composeRoutes } from "./routes/compose";
import { conversationsRoutes } from "./routes/conversations";
import { pollPortRequests } from "./telnyx/porting";
import { reconcileNumbers, sweepStuckProvisioning } from "./telnyx/provisioning";
import { reconcileTextEnablement } from "./telnyx/text-enablement";
import { reconcileVoiceEnablement } from "./telnyx/voice";
import {
  nudgeSoleProprietorOtp,
  pollRegistrations,
  retryCampaignAssignments,
} from "./telnyx/registration";
import {
  companyMembersRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type CapturedRequest,
  type TestAuth,
} from "./test/support";

const env = completeEnv();
const ORIGIN = env.APP_ORIGIN;
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;

// Probe route registered behind the real /v1 chain so tests can observe the
// context the middleware attached. Module scope: Hono freezes its router on
// the first request.
app.get("/v1/__test__/context", (c) =>
  c.json({
    userId: c.get("userId"),
    companyId: c.get("companyId"),
    role: c.get("role"),
    memberId: c.get("memberId"),
  }),
);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("middleware order on /v1/* (CORS → JWT → company context)", () => {
  it("full chain: valid JWT + active membership reaches the handler with full context", async () => {
    const captured: CapturedRequest = {};
    stubFetch(
      jwksRoute(auth),
      companyMembersRoute(env, [{ id: MEMBER_ID, role: "owner" }], captured),
    );
    const res = await app.request(
      "/v1/__test__/context",
      {
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: auth.subject,
      companyId: COMPANY_ID,
      role: "owner",
      memberId: MEMBER_ID,
    });
    // The membership lookup used the sub the JWT middleware verified —
    // proof that JWT ran before company context.
    expect(captured.url!.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
  });

  it("JWT runs before company context: no token is 401 even with a valid X-Company-Id", async () => {
    stubFetch(); // neither JWKS nor PostgREST may be touched
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { "X-Company-Id": COMPANY_ID } },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("company context runs after JWT: valid token without the header is 422", async () => {
    stubFetch(jwksRoute(auth));
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { Authorization: `Bearer ${await auth.token()}` } },
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "validation_failed", message: expect.any(String) },
    });
  });

  it("valid token but no membership is 403", async () => {
    stubFetch(jwksRoute(auth), companyMembersRoute(env, []));
    const res = await app.request(
      "/v1/__test__/context",
      {
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("/health stays outside the chain (no auth required)", async () => {
    stubFetch();
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("CORS (SPEC §7: exact origin, enumerated methods/headers, none on /webhooks/*)", () => {
  it("answers a preflight for the exact APP_ORIGIN without requiring auth", async () => {
    stubFetch(); // preflight must not hit JWT/JWKS at all
    const res = await app.request(
      "/v1/__test__/context",
      {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,x-company-id",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
      expect(methods).toContain(method);
    }
    const headers = res.headers.get("access-control-allow-headers") ?? "";
    for (const header of [
      "Authorization",
      "X-Company-Id",
      "Idempotency-Key",
      "Content-Type",
    ]) {
      expect(headers).toContain(header);
    }
  });

  it("echoes the allowed origin on actual /v1 responses (even auth failures)", async () => {
    stubFetch();
    const res = await app.request(
      "/v1/__test__/context",
      { headers: { Origin: ORIGIN } },
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("refuses any other origin (no wildcard, no echo)", async () => {
    stubFetch();
    const preflight = await app.request(
      "/v1/__test__/context",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

    const actual = await app.request(
      "/v1/__test__/context",
      { headers: { Origin: "https://evil.example" } },
      env,
    );
    expect(actual.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/webhooks/* authenticates by provider signature (not JWT) and carries no CORS headers", async () => {
    // Signature rejection is local crypto/header work: no JWKS, no PostgREST.
    stubFetch();
    for (const path of ["/webhooks/telnyx", "/webhooks/stripe"]) {
      // Unsigned POST → 400 from the route's own verify step. A 401 here
      // would mean the JWT chain leaked onto /webhooks/*; a 404 would mean
      // the route is not mounted.
      const post = await app.request(
        path,
        { method: "POST", headers: { Origin: ORIGIN }, body: "{}" },
        env,
      );
      expect(post.status).toBe(400);
      expect(post.headers.get("access-control-allow-origin")).toBeNull();

      // No CORS middleware on /webhooks/*: preflights find no handler and
      // never earn CORS headers (SPEC §7).
      const preflight = await app.request(
        path,
        {
          method: "OPTIONS",
          headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
        },
        env,
      );
      expect(preflight.status).toBe(404);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight.headers.get("access-control-allow-methods")).toBeNull();
    }
  });
});

describe("route inventory (SPEC §7: every built sub-app mounted under /v1)", () => {
  /** Registered (method, path) pairs, trailing slash normalized. */
  const registered = new Set(
    app.routes.map(
      (route) =>
        `${route.method} ${route.path !== "/" && route.path.endsWith("/") ? route.path.slice(0, -1) : route.path}`,
    ),
  );

  const EXPECTED: [string, string][] = [
    ["GET", "/health"],
    // me / companies
    ["GET", "/v1/me"],
    ["POST", "/v1/companies"],
    ["GET", "/v1/company"],
    ["PATCH", "/v1/company"],
    // billing
    ["POST", "/v1/billing/checkout"],
    ["POST", "/v1/billing/portal"],
    ["POST", "/v1/billing/change-plan"],
    ["GET", "/v1/usage"],
    // numbers
    ["GET", "/v1/numbers"],
    ["POST", "/v1/numbers/provision"],
    ["DELETE", "/v1/numbers/:id"],
    // registration
    ["GET", "/v1/registration"],
    ["PUT", "/v1/registration"],
    ["POST", "/v1/registration/submit"],
    ["POST", "/v1/registration/otp"],
    ["POST", "/v1/registration/otp/resend"],
    ["POST", "/v1/registration/enable-us"],
    // porting (port-in)
    ["POST", "/v1/port-requests/check"],
    ["POST", "/v1/port-requests"],
    ["GET", "/v1/port-requests"],
    ["GET", "/v1/port-requests/:id"],
    ["PUT", "/v1/port-requests/:id"],
    ["PUT", "/v1/port-requests/:id/documents"],
    ["POST", "/v1/port-requests/:id/resubmit"],
    ["POST", "/v1/port-requests/:id/cancel"],
    // keep-your-number text-enablement (hosted SMS)
    ["POST", "/v1/text-enablements"],
    ["GET", "/v1/text-enablements"],
    ["GET", "/v1/text-enablements/:id"],
    ["POST", "/v1/text-enablements/:id/cancel"],
    // conversations (compose owns the POST)
    ["POST", "/v1/conversations"],
    ["GET", "/v1/conversations"],
    ["GET", "/v1/conversations/:id"],
    ["PATCH", "/v1/conversations/:id"],
    ["GET", "/v1/conversations/:id/events"],
    ["POST", "/v1/conversations/:id/notes"],
    ["POST", "/v1/conversations/:id/read"],
    ["POST", "/v1/conversations/:id/tags"],
    ["DELETE", "/v1/conversations/:id/tags/:tag_id"],
    // tasks (D17) — the checklist read shares the /conversations/:id space
    ["GET", "/v1/conversations/:id/tasks"],
    ["POST", "/v1/tasks"],
    ["GET", "/v1/tasks"],
    ["GET", "/v1/tasks/:id"],
    ["PATCH", "/v1/tasks/:id"],
    ["DELETE", "/v1/tasks/:id"],
    // attachments gallery (D21) — the union read shares /conversations/:id space
    ["GET", "/v1/conversations/:id/attachments"],
    // messages
    ["GET", "/v1/conversations/:id/messages"],
    ["POST", "/v1/messages/send"],
    ["POST", "/v1/messages/:id/retry"],
    // attachments (MMS signed-url + generic note/task upload/list/sign, D19)
    ["GET", "/v1/attachments/:id/url"],
    ["POST", "/v1/attachments"],
    ["GET", "/v1/attachments"],
    ["DELETE", "/v1/attachments/:id"],
    // contacts
    ["GET", "/v1/contacts"],
    ["GET", "/v1/contacts/export"],
    ["POST", "/v1/contacts"],
    ["GET", "/v1/contacts/:id"],
    ["PATCH", "/v1/contacts/:id"],
    ["DELETE", "/v1/contacts/:id"],
    ["POST", "/v1/contacts/import"],
    ["POST", "/v1/contacts/import-vcard"],
    ["POST", "/v1/contacts/:id/opt-out"],
    ["POST", "/v1/contacts/:id/opt-out/revoke"],
    // tags / templates / search
    ["GET", "/v1/tags"],
    ["PATCH", "/v1/tags/:id"],
    ["DELETE", "/v1/tags/:id"],
    ["GET", "/v1/templates"],
    ["POST", "/v1/templates"],
    ["PATCH", "/v1/templates/:id"],
    ["DELETE", "/v1/templates/:id"],
    ["GET", "/v1/search"],
    // team
    ["GET", "/v1/members"],
    ["PATCH", "/v1/members/:id"],
    ["DELETE", "/v1/members/:id"],
    ["GET", "/v1/invites"],
    ["POST", "/v1/invites"],
    ["DELETE", "/v1/invites/:id"],
    ["POST", "/v1/invites/accept"],
    // notifications
    ["GET", "/v1/notification-prefs"],
    ["PUT", "/v1/notification-prefs"],
    ["POST", "/v1/push-subscriptions"],
    ["DELETE", "/v1/push-subscriptions/:id"],
    // notifications read-model (D24) + for-you home (D23)
    ["GET", "/v1/notifications"],
    ["GET", "/v1/notifications/unread-count"],
    ["POST", "/v1/notifications/mark-all-read"],
    ["POST", "/v1/notifications/mark-read"],
    ["POST", "/v1/notifications/:id/read"],
    ["GET", "/v1/for-you"],
    // webhooks (unversioned, outside the /v1 chain)
    ["POST", "/webhooks/telnyx"],
    ["POST", "/webhooks/stripe"],
  ];

  it.each(EXPECTED)("%s %s is mounted", (method, path) => {
    expect(registered.has(`${method} ${path}`)).toBe(true);
  });

  it("POST /v1/conversations resolves to compose: the general router registers no competing handler", () => {
    // compose owns the outbound-first POST (SPEC §7) and is mounted first;
    // the general conversations router must not register the same route at
    // all, so there is no order-dependent shadowing to regress.
    const composeOwners = composeRoutes.routes.filter(
      (route) => route.method === "POST" && route.path === "/conversations",
    );
    const generalOwners = conversationsRoutes.routes.filter(
      (route) => route.method === "POST" && route.path === "/conversations",
    );
    expect(composeOwners.length).toBeGreaterThan(0);
    expect(generalOwners).toHaveLength(0);
    // And the mounted app carries exactly compose's registrations, nothing more.
    const appOwners = app.routes.filter(
      (route) => route.method === "POST" && route.path === "/v1/conversations",
    );
    expect(appOwners).toHaveLength(composeOwners.length);
  });
});

describe("scheduled jobs (SPEC §11: cron map ↔ wrangler.jsonc lockstep)", () => {
  /** The §11 schedule set, extracted from wrangler.jsonc's triggers block. */
  function wranglerCrons(): string[] {
    const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const block = /"crons":\s*\[([\s\S]*?)\]/.exec(raw);
    if (!block) throw new Error("wrangler.jsonc has no crons block");
    return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  }

  it("CRON_JOBS covers exactly the wrangler.jsonc schedule set", () => {
    expect(Object.keys(CRON_JOBS).sort()).toEqual(wranglerCrons().sort());
  });

  it("wrangler.jsonc carries exactly the §11 + porting schedules", () => {
    expect(wranglerCrons().sort()).toEqual(
      [
        "*/5 * * * *", // webhook sweeper
        "*/15 * * * *", // provisioning retry & reconcile
        "0 * * * *", // usage re-reporter (+ 80%/100% usage alerts)
        "30 * * * *", // sole-prop OTP nudge
        "20 * * * *", // contact geocoding backfill (D25)
        "40 * * * *", // task-address geocoding backfill (#214 Map fix)
        "0 13 * * *", // registration poller
        "10 13 * * *", // port reconcile & resume (PORTING.md §5.2)
        "0 14 * * *", // grace & release
        "0 15 * * *", // subscription reconcile
      ].sort(),
    );
  });

  it("each schedule dispatches to the §11 job(s), by identity", () => {
    expect(CRON_JOBS["*/5 * * * *"]).toEqual([
      sweepWebhookEvents,
      failStuckOutboundSends,
      sweepStuckProvisioning,
    ]);
    expect(CRON_JOBS["*/15 * * * *"]).toEqual([
      reconcileNumbers,
      retryCampaignAssignments,
      sweepDeletedAttachments,
      reconcileTextEnablement,
      reconcileVoiceEnablement,
    ]);
    expect(CRON_JOBS["0 * * * *"]).toEqual([
      reportUnreportedUsage,
      reportUnreportedVoiceUsage,
      runUsageAlertsJob,
      runOverageWarningJob,
      sweepStaleCalls, // #133: stale-calls sweeper (in-flight >4h → missed)
    ]);
    expect(CRON_JOBS["30 * * * *"]).toEqual([nudgeSoleProprietorOtp]);
    expect(CRON_JOBS["20 * * * *"]).toEqual([geocodeContactsJob]);
    expect(CRON_JOBS["0 13 * * *"]).toEqual([pollRegistrations]);
    expect(CRON_JOBS["10 13 * * *"]).toEqual([pollPortRequests]);
    expect(CRON_JOBS["0 14 * * *"]).toEqual([runGraceJob]);
    expect(CRON_JOBS["0 15 * * *"]).toEqual([runSubscriptionReconcileJob]);
  });
});
