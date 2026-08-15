/**
 * #243 — API key management.
 *
 * This route mints credentials, so the assertions are about what must never
 * happen: the token reaching the database, the hash reaching a client, a
 * revocation overwriting the first one, or somebody without `settings.manage`
 * seeing the list of what can reach this workspace's data.
 *
 * Only the network edge is stubbed, so the hashing is real SHA-256 and the
 * insert body is what supabase-js actually encodes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { API_KEY_PREFIX } from "@loonext/shared";

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
import { apiKeysRoutes } from "./api-keys";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const KEY_ID = "cccccccc-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(apiKeysRoutes);

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

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY_ID,
    name: "Scheduling tool",
    token_prefix: `${API_KEY_PREFIX}AbCdEfGh`,
    scopes: ["contacts:read"],
    created_by: MEMBER_ID,
    created_at: "2026-08-01T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    revoked_by: null,
    expires_at: null,
    ...overrides,
  };
}

const token = () => auth.token();

describe("GET /v1/api-keys", () => {
  it("lists keys scoped to the workspace and never asks for the hash", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/api_keys", () => [keyRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[]; cap: number; live: number };
    expect(body.keys).toHaveLength(1);
    expect(body.cap).toBe(10);
    expect(body.live).toBe(1);

    const call = sb.find("GET", "/rest/v1/api_keys")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // The column list is the enforcement. Anything that can read `token_hash`
    // can check a stolen token against it offline.
    expect(call.url.searchParams.get("select")).not.toContain("token_hash");
  });

  it("counts only live keys against the cap, so revoking makes room", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/api_keys", () => [
      keyRow(),
      keyRow({ id: "other", revoked_at: "2026-08-02T00:00:00Z" }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as { keys: unknown[]; live: number };
    // Both listed — "what did we turn off, and when" is an incident question.
    expect(body.keys).toHaveLength(2);
    // One live. A cap that counted revoked keys would punish the very thing we
    // want somebody to do after a leak.
    expect(body.live).toBe(1);
  });

  it("is closed to a member who cannot manage settings", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/api-keys", () => {
  it("stores a hash and a stub, never the token, and returns it once", async () => {
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/api_keys", () => [keyRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "Scheduling tool", scopes: ["contacts:read", "contacts:read"] },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token_once: string; key: Record<string, unknown> };

    expect(body.token_once.startsWith(API_KEY_PREFIX)).toBe(true);
    // 32 bytes of base64url, unpadded.
    expect(body.token_once.length).toBeGreaterThan(40);

    const insert = sb.find("POST", "/rest/v1/api_keys")[0];
    const written = insert.body as {
      token_hash: string;
      token_prefix: string;
      scopes: string[];
    };
    // THE ONE THAT MATTERS. Nothing we send to the database contains the
    // token, and nothing in it could be turned back into one.
    expect(JSON.stringify(insert.body)).not.toContain(body.token_once);
    expect(written.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The stub is a PREFIX of the real token, which is what makes it useful
    // for telling three keys apart — and short enough to be useless otherwise.
    expect(body.token_once.startsWith(written.token_prefix)).toBe(true);
    expect(written.token_prefix.length).toBe(12);
    // A duplicate scope is a client bug, not twice the permission.
    expect(written.scopes).toEqual(["contacts:read"]);
  });

  it("mints a different token every time", async () => {
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/api_keys", () => [keyRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const first = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "one", scopes: ["contacts:read"] },
    });
    const second = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "two", scopes: ["contacts:read"] },
    });

    const a = (await first.json()) as { token_once: string };
    const b = (await second.json()) as { token_once: string };
    expect(a.token_once).not.toBe(b.token_once);
  });

  it("records what the key can do, and never the token", async () => {
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/api_keys", () => [keyRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "Scheduling tool", scopes: ["tasks:write"] },
    });
    const body = (await res.json()) as { token_once: string };

    const entry = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      action: string;
      after: { scopes: string[] };
    };
    expect(entry.action).toBe("api_key.created");
    // "What could that key do" is the question an incident review asks.
    expect(entry.after.scopes).toEqual(["tasks:write"]);
    expect(JSON.stringify(entry)).not.toContain(body.token_once);
  });

  it("refuses a scope it never promised", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "x", scopes: ["*"] },
    });
    // A key is never a bearer of full account power, and the wildcard is how
    // that stops being true.
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/api_keys")).toHaveLength(0);
  });

  it("turns the database cap into an answer the person can act on", async () => {
    const sb = stubWithRole("owner");
    sb.on(
      "POST",
      "/rest/v1/api_keys",
      () =>
        new Response(
          JSON.stringify({ message: "api key cap reached for company x", code: "23514" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/api-keys", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { name: "x", scopes: ["contacts:read"] },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "10",
    );
  });
});

describe("DELETE /v1/api-keys/:id", () => {
  it("stamps the revocation rather than deleting the row", async () => {
    const sb = stubWithRole("owner");
    sb.on("PATCH", "/rest/v1/api_keys", () => [
      keyRow({ revoked_at: "2026-08-14T00:00:00Z" }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/api-keys/${KEY_ID}`, {
      companyId: COMPANY_ID,
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    const call = sb.find("PATCH", "/rest/v1/api_keys")[0];
    const patch = call.body as { revoked_at: string; revoked_by: string };
    expect(patch.revoked_at).toBeTruthy();
    expect(patch.revoked_by).toBeTruthy();
    // Only a key that is still live. Revoking twice must not overwrite who did
    // it first — the FIRST revocation is the one an incident review cares
    // about.
    expect(call.url.searchParams.get("revoked_at")).toBe("is.null");

    const entry = sb.find("POST", "/rest/v1/audit_log")[0].body as { action: string };
    expect(entry.action).toBe("api_key.revoked");
  });

  it("404s a key that belongs to somebody else", async () => {
    const sb = stubWithRole("owner");
    sb.on("PATCH", "/rest/v1/api_keys", () => []);
    sb.on("GET", "/rest/v1/api_keys", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/api-keys/${KEY_ID}`, {
      companyId: COMPANY_ID,
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("is idempotent for a key that is already off", async () => {
    const sb = stubWithRole("owner");
    // The guarded update matches nothing, but the key exists.
    sb.on("PATCH", "/rest/v1/api_keys", () => []);
    sb.on("GET", "/rest/v1/api_keys", () => [{ id: KEY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), `/v1/api-keys/${KEY_ID}`, {
      companyId: COMPANY_ID,
      method: "DELETE",
    });
    // The caller asked for "not live", and it is not live. No second audit row
    // either — nothing happened.
    expect(res.status).toBe(204);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });
});
