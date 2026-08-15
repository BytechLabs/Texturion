/**
 * #243 — the webhook management routes.
 *
 * The properties worth pinning are the ones that would be silent if wrong: the
 * signing secret leaking into a list response, an endpoint pointed at a
 * private address getting stored anyway, a read_only member reading the list
 * of third parties this workspace's messages flow to, and a test send that
 * reports success because the REQUEST succeeded rather than because the
 * receiver accepted it.
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
import { webhooksRoutes } from "./webhooks";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const ENDPOINT_ID = "cccccccc-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(webhooksRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, role));
  sb.on("POST", "/rest/v1/audit_log", () => []);
  return sb;
}

function endpointRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENDPOINT_ID,
    url: "https://hooks.example.com/loonext",
    description: "Scheduling tool",
    events: ["message.received"],
    active: true,
    disabled_reason: null,
    disabled_at: null,
    consecutive_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const token = () => auth.token();

describe("GET /v1/webhooks", () => {
  it("lists endpoints scoped to the workspace and never asks for the secret", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [endpointRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { endpoints: unknown[]; cap: number };
    expect(body.endpoints).toHaveLength(1);
    expect(body.cap).toBe(10);

    const call = sb.find("GET", "/rest/v1/webhook_endpoints")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // The column list is the enforcement, so it is what gets asserted. A
    // `select("*")` here would leak the HMAC key to every admin's browser
    // devtools and every client-side error report.
    expect(call.url.searchParams.get("select")).not.toContain("secret");
  });

  it("is closed to a member who cannot manage settings", async () => {
    const sb = stubWithRole("read_only");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
    });
    // The endpoint list names the third parties this workspace's message
    // content flows to, and the URLs routinely carry a per-tenant token.
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/webhooks", () => {
  it("mints a prefixed secret, returns it exactly once, and audits the destination", async () => {
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/webhook_endpoints", () => [endpointRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {
        url: "https://hooks.example.com/loonext",
        events: ["message.received", "message.received", "task.created"],
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { secret_once: string; endpoint: Record<string, unknown> };
    expect(body.secret_once).toMatch(/^whsec_[0-9a-f]{64}$/);
    // Nothing in the endpoint object repeats it.
    expect(JSON.stringify(body.endpoint)).not.toContain(body.secret_once);

    const insert = sb.find("POST", "/rest/v1/webhook_endpoints")[0];
    const written = insert.body as { secret: string; events: string[] };
    expect(written.secret).toBe(body.secret_once);
    // The duplicate is dropped rather than stored — storing it would fire the
    // endpoint twice for one event.
    expect(written.events).toEqual(["message.received", "task.created"]);

    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    const entry = audit.body as { action: string; after: { url: string } };
    expect(entry.action).toBe("webhook.endpoint_created");
    expect(entry.after.url).toBe("https://hooks.example.com/loonext");
    // "Where did our messages start going" is the question. "What signs them"
    // is not, and must never be in the record.
    expect(JSON.stringify(entry)).not.toContain("whsec_");
  });

  it("refuses an address inside a private network, naming the rule", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { url: "https://169.254.169.254/latest/meta-data/", events: ["message.sent"] },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    // A catalogue key, so all three clients can say which rule bit in the
    // reader's own language.
    expect(body.error.message).toBe("webhooks.urlError.privateHost");
    // And nothing was written.
    expect(sb.find("POST", "/rest/v1/webhook_endpoints")).toHaveLength(0);
  });

  it("refuses plain http, which would carry customer content in clear", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { url: "http://hooks.example.com/x", events: ["message.sent"] },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "webhooks.urlError.notHttps",
    );
  });

  it("refuses an event name it does not promise", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { url: "https://hooks.example.com/x", events: ["message.delivered"] },
    });
    // Every name in the vocabulary is a permanent commitment to somebody
    // else's code, so one we never published cannot be subscribed to.
    expect(res.status).toBe(422);
  });

  it("turns the database cap into an answer the person can act on", async () => {
    const sb = stubWithRole("owner");
    sb.on(
      "POST",
      "/rest/v1/webhook_endpoints",
      () =>
        new Response(
          JSON.stringify({
            message: 'webhook endpoint cap reached for company 8a1b3c5d',
            code: "23514",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/webhooks", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { url: "https://hooks.example.com/x", events: ["message.sent"] },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("10");
  });
});

describe("PATCH /v1/webhooks/:id", () => {
  it("clears the failure streak when the customer re-enables an endpoint", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [
      endpointRow({ active: false, consecutive_failures: 20, disabled_reason: "x" }),
    ]);
    sb.on("PATCH", "/rest/v1/webhook_endpoints", () => [endpointRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}`, {
      companyId: COMPANY_ID,
      method: "PATCH",
      body: { active: true },
    });
    expect(res.status).toBe(200);

    const patch = sb.find("PATCH", "/rest/v1/webhook_endpoints")[0].body as Record<string, unknown>;
    // Leaving the counter at 20 would let the next single failure re-disable
    // an endpoint the customer just fixed, which reads as the toggle not
    // working.
    expect(patch.consecutive_failures).toBe(0);
    expect(patch.disabled_reason).toBeNull();
  });

  it("re-runs the address gate on an edit, not only at creation", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}`, {
      companyId: COMPANY_ID,
      method: "PATCH",
      body: { url: "https://localhost:9000/x" },
    });
    expect(res.status).toBe(422);
    expect(sb.find("PATCH", "/rest/v1/webhook_endpoints")).toHaveLength(0);
  });

  it("404s an endpoint belonging to somebody else", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_endpoints", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}`, {
      companyId: COMPANY_ID,
      method: "PATCH",
      body: { active: false },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/webhooks/:id/secret", () => {
  it("mints a new secret, shows it once, and records that it happened", async () => {
    const sb = stubWithRole("owner");
    sb.on("PATCH", "/rest/v1/webhook_endpoints", () => [endpointRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}/secret`, {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret_once: string };
    expect(body.secret_once).toMatch(/^whsec_[0-9a-f]{64}$/);

    const patch = sb.find("PATCH", "/rest/v1/webhook_endpoints")[0].body as { secret: string };
    expect(patch.secret).toBe(body.secret_once);

    const entry = sb.find("POST", "/rest/v1/audit_log")[0].body as { action: string };
    // Rotating is what somebody does after a leak — and also what somebody
    // does to lock the real owner out of their own integration.
    expect(entry.action).toBe("webhook.secret_rotated");
  });
});

describe("POST /v1/webhooks/:id/test", () => {
  it("signs a ping with the stored secret and relays what the receiver said", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [
      { id: ENDPOINT_ID, url: "https://hooks.example.com/loonext", secret: "whsec_abc" },
    ]);
    let seen: { signature: string; event: string; body: string } | null = null;
    const receiver = async (url: URL, request: Request) => {
      if (url.origin !== "https://hooks.example.com") return undefined;
      seen = {
        signature: request.headers.get("loonext-signature") ?? "",
        event: request.headers.get("loonext-event") ?? "",
        body: await request.clone().text(),
      };
      return new Response("thanks", { status: 200 });
    };
    stubFetch(jwksRoute(auth), sb.route, receiver);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}/test`, {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 200 });

    const sent = seen as unknown as { signature: string; event: string; body: string };
    expect(sent.signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // `ping` is not in the subscribable vocabulary, on purpose: firing a fake
    // `message.received` would teach the receiver's code to act on an event
    // that never happened.
    expect(sent.event).toBe("ping");
    expect((JSON.parse(sent.body) as { type: string }).type).toBe("ping");
  });

  it("reports a non-2xx as a failed test rather than a successful request", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [
      { id: ENDPOINT_ID, url: "https://hooks.example.com/loonext", secret: "whsec_abc" },
    ]);
    const receiver = async (url: URL) =>
      url.origin === "https://hooks.example.com"
        ? new Response("nope", { status: 403 })
        : undefined;
    stubFetch(jwksRoute(auth), sb.route, receiver);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}/test`, {
      companyId: COMPANY_ID,
      method: "POST",
    });
    // The person pressed a button to find out. Both answers are the button
    // working, so both are 200 — what changes is `ok`.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, status: 403 });
  });

  it("refuses to ping an address that would fail the gate today", async () => {
    const sb = stubWithRole("owner");
    // Stored before the rule tightened — exactly the row worth refusing.
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [
      { id: ENDPOINT_ID, url: "https://10.0.0.5/hook", secret: "whsec_abc" },
    ]);
    let posted = 0;
    const receiver = async (url: URL) => {
      if (url.hostname === "10.0.0.5") {
        posted += 1;
        return new Response("", { status: 200 });
      }
      return undefined;
    };
    stubFetch(jwksRoute(auth), sb.route, receiver);

    const res = await apiRequest(app, env, await token(), `/v1/webhooks/${ENDPOINT_ID}/test`, {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(422);
    expect(posted).toBe(0);
  });
});

describe("GET /v1/webhooks/:id/deliveries", () => {
  it("scopes the log to the workspace and the endpoint, and omits the payload", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/webhook_deliveries", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/webhooks/${ENDPOINT_ID}/deliveries`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);

    const call = sb.find("GET", "/rest/v1/webhook_deliveries")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("endpoint_id")).toBe(`eq.${ENDPOINT_ID}`);
    // The log is for debugging delivery, not for re-reading message content
    // through a second door — the payload column stays out of the response.
    expect(call.url.searchParams.get("select")).not.toContain("payload");
  });
});
