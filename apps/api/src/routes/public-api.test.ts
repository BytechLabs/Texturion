/**
 * #243 — the public API's door.
 *
 * The assertions that matter are the refusals. A public surface's whole risk
 * is that something reaches it which should not: an unknown token, a revoked
 * one, a key whose creator has left the workspace, or a key holding one scope
 * being used for another. Each of those is a separate failure and each is
 * pinned here.
 *
 * Only the network edge is stubbed, so the token hashing is real SHA-256 and
 * the request bodies go through real supabase-js encoding.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { API_KEY_PREFIX, PUBLIC_API_VERSION_HEADER } from "@loonext/shared";

import { Hono } from "hono";

import type { AppEnv } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import {
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
import { publicApiRoutes } from "./public-api";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CREATOR = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const KEY_ID = "cccccccc-1111-4222-8333-444444444444";
const TOKEN = `${API_KEY_PREFIX}0123456789abcdef0123456789abcdef`;

let auth: TestAuth;

/**
 * The public surface mounts at the ROOT, not under `/v1`, and carries its own
 * credential instead of the JWT + company-context chain.
 *
 * So it cannot use `buildTestApp`, which exists to reproduce that chain — and
 * using it would be worse than inconvenient: the routes would answer behind a
 * member session, which is the one thing this surface must never require. This
 * mirrors `index.ts`'s mount exactly, including the shared `onError`, so a
 * refusal here is shaped like a refusal in production.
 */
const app = new Hono<AppEnv>();
app.route("/", publicApiRoutes);
app.notFound((c) => errorResponse(c, "not_found", "No such route."));
app.onError((error, c) => {
  if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
  throw error;
});

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A stub where the token resolves and its creator is an active member.
 *
 * `scopes` is the knob every test below turns; the point of the surface is
 * that holding one scope grants exactly one thing.
 */
function stubWithKey(scopes: string[], role = "owner"): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
    { id: KEY_ID, company_id: COMPANY_ID, scopes, created_by: CREATOR },
  ]);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

/** A public request carries a key, never a session or a company header. */
function publicRequest(path: string, init: RequestInit = {}) {
  return app.request(
    `http://localhost${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    },
    env,
  );
}

describe("the door", () => {
  it("answers with the version on every response, including refusals", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await app.request(
      "http://localhost/public/v1/me",
      { headers: {} },
      env,
    );
    expect(res.status).toBe(401);
    // A client that pins nothing still gets told what answered, which is what
    // turns "our integration broke" into a report with a fact in it.
    expect(res.headers.get(PUBLIC_API_VERSION_HEADER)).toBe("v1");
  });

  it("never reaches the database for something that is not one of our tokens", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await app.request(
      "http://localhost/public/v1/me",
      { headers: { Authorization: "Bearer hunter2" } },
      env,
    );
    expect(res.status).toBe(401);
    // The prefix check is what keeps an unauthenticated request costing a
    // string comparison instead of a lookup.
    expect(sb.find("POST", "/rest/v1/rpc/api_resolve_key")).toHaveLength(0);
  });

  it("refuses an unknown, revoked or expired key with one indistinguishable answer", async () => {
    const sb = supabaseStub(env);
    // The RPC answers with nothing for all three cases, on purpose.
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    // Nothing in the answer says which of the three it was — a public endpoint
    // that distinguishes them tells whoever is guessing which guess was real.
    expect(body.error.message).toBe("That API key is not valid.");
  });

  it("stops working when the creator is no longer an active member", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
      { id: KEY_ID, company_id: COMPANY_ID, scopes: ["contacts:read"], created_by: CREATOR },
    ]);
    // No membership: the person was deactivated or removed.
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", () => ({
      session_revoked: false,
      session_new: false,
      member: null,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    // THE ONE THAT MATTERS. A key must never become a way to keep an access
    // that has been withdrawn, and the membership is resolved live on every
    // request precisely so this cannot be cached into being true.
    expect(res.status).toBe(403);
    // Asserted by MESSAGE, not just status, and that is not fussiness. With
    // only the status, this test passed while the membership check was
    // disabled — the capability gate downstream refused a caller with no role
    // and produced the same 403. A guard whose answer is indistinguishable
    // from its neighbour's is measuring the neighbour.
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("no longer active in this workspace");
  });

  it("does not reach the workspace's data when the creator has left", async () => {
    // The other half of the same claim: refusing is not enough if the query
    // already ran. Nothing below the middleware may execute.
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
      { id: KEY_ID, company_id: COMPANY_ID, scopes: ["contacts:read"], created_by: CREATOR },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", () => ({
      session_revoked: false,
      session_new: false,
      member: null,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    await publicRequest("/public/v1/contacts");
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("says what the key is and what it may do, without needing a scope to ask", async () => {
    const sb = stubWithKey(["contacts:read", "tasks:write"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      company_id: COMPANY_ID,
      key_id: KEY_ID,
      scopes: ["contacts:read", "tasks:write"],
    });
  });

  it("hashes the token rather than sending it", async () => {
    const sb = stubWithKey(["contacts:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    await publicRequest("/public/v1/me");

    const call = sb.find("POST", "/rest/v1/rpc/api_resolve_key")[0];
    const body = call.body as { p_token_hash: string };
    expect(body.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The token itself must not appear anywhere in what we send.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});

describe("scopes are the second gate", () => {
  it("lets a key read contacts when it holds contacts:read", async () => {
    const sb = stubWithKey(["contacts:read"]);
    sb.on("GET", "/rest/v1/contacts", () => [{ id: "ct-1", phone_e164: "+14165550100" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; limit: number };
    expect(body.data).toHaveLength(1);
    expect(body.limit).toBe(25);

    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // The published column list is the enforcement — a `select("*")` here
    // would publish every internal column as a shape somebody parses.
    expect(call.url.searchParams.get("select")).not.toContain("custom_fields");
  });

  it("refuses a read to a key that can only write", async () => {
    // Write does not imply read. A key that may create a contact has no
    // business enumerating the customer list.
    const sb = stubWithKey(["contacts:write"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses a write to a key that can only read", async () => {
    const sb = stubWithKey(["contacts:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts", {
      method: "POST",
      body: JSON.stringify({ phone_e164: "+14165550100" }),
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses every route to a key holding no scope at all", async () => {
    const sb = stubWithKey([]);
    stubFetch(jwksRoute(auth), sb.route);

    for (const path of ["/public/v1/contacts", "/public/v1/tasks"]) {
      const res = await publicRequest(path);
      expect(res.status, path).toBe(403);
    }
  });

  it("still applies the CREATOR's capability, not just the key's scope", async () => {
    // A bookkeeper holds billing and nothing else (#315). Their key carries
    // their role, so the same scopes reach less than an owner's would — which
    // is the whole point of a key acting AS the person who made it.
    const sb = stubWithKey(["contacts:read"], "bookkeeper");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });
});

describe("writes", () => {
  it("upserts a contact so a connector replaying its queue does not duplicate", async () => {
    const sb = stubWithKey(["contacts:write"]);
    sb.on("POST", "/rest/v1/contacts", () => [
      { id: "ct-1", phone_e164: "+14165550100" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts", {
      method: "POST",
      body: JSON.stringify({ phone_e164: "+14165550100", name: "Maria Alvarez" }),
    });
    expect(res.status).toBe(201);

    const call = sb.find("POST", "/rest/v1/contacts")[0];
    // A replayed queue is the normal case for an integration, not the
    // exception, so the conflict target has to be the one the first-party
    // route uses.
    expect(call.url.searchParams.get("on_conflict")).toBe("company_id,phone_e164");
    expect(call.body).toMatchObject({
      company_id: COMPANY_ID,
      phone_e164: "+14165550100",
      name: "Maria Alvarez",
      created_by_user_id: CREATOR,
    });
  });

  it("creates a task through the same RPC the first-party route uses", async () => {
    const sb = stubWithKey(["tasks:write"]);
    sb.on("POST", "/rest/v1/rpc/create_task", () => ({
      outcome: "created",
      task: { id: "tk-1", title: "Fix the boiler" },
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        message_id: "11111111-1111-4111-8111-111111111111",
        title: "Fix the boiler",
      }),
    });
    expect(res.status).toBe(201);

    // A public path that wrote the table directly would be a second way to
    // create a task, and the second way is the one that forgets the audit row.
    const call = sb.find("POST", "/rest/v1/rpc/create_task")[0];
    expect(call.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_actor_user_id: CREATOR,
      p_title: "Fix the boiler",
    });
  });

  it("reports an already-promoted message as a conflict rather than a 500", async () => {
    const sb = stubWithKey(["tasks:write"]);
    sb.on("POST", "/rest/v1/rpc/create_task", () => ({ outcome: "conflict" }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ message_id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(409);
  });

  it("bounds a page even when the caller asks for everything", async () => {
    const sb = stubWithKey(["tasks:read"]);
    sb.on("GET", "/rest/v1/tasks", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks?limit=100000");
    expect(res.status).toBe(200);
    expect((await res.json()) as { limit: number }).toMatchObject({ limit: 100 });
  });
});
