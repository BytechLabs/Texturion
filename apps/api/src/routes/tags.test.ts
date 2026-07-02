/**
 * Tag routes (SPEC §7, §10): member list/rename, owner/admin-only delete.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
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
import { tagsRoutes } from "./tags";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TAG_ID = "bbbbbbbb-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(tagsRoutes);

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

describe("GET /v1/tags", () => {
  it("lists company tags for any member", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tags", () => [
      { id: TAG_ID, name: "Won", color: null },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/tags", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: TAG_ID, name: "Won", color: null }],
      next_cursor: null,
    });
    const call = sb.find("GET", "/rest/v1/tags")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });
});

describe("PATCH /v1/tags/:id", () => {
  it("renames as a member; 409s a duplicate name", async () => {
    const sb = stubWithRole("member");
    let first = true;
    sb.on("PATCH", "/rest/v1/tags", () => {
      if (first) {
        first = false;
        return [{ id: TAG_ID, name: "Renamed", color: null }];
      }
      return pgError("23505", "duplicate key value violates tags_name_uq");
    });
    stubFetch(jwksRoute(auth), sb.route);

    const ok = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Renamed" } },
    );
    expect(ok.status).toBe(200);

    const dup = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Won" } },
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({
      error: { code: "conflict", message: expect.any(String) },
    });
  });

  it("404s an unknown tag; 422s an empty patch and a bad color", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "X" } },
    );
    expect(missing.status).toBe(404);

    for (const body of [{}, { color: "red" }]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/tags/${TAG_ID}`,
        { method: "PATCH", companyId: COMPANY_ID, body },
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("DELETE /v1/tags/:id (O/A only)", () => {
  it("403s a plain member", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
  });

  it("deletes as admin and owner; 404s unknown", async () => {
    for (const role of ["admin", "owner"]) {
      const sb = stubWithRole(role);
      sb.on("DELETE", "/rest/v1/tags", () => [{ id: TAG_ID }]);
      stubFetch(jwksRoute(auth), sb.route);
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/tags/${TAG_ID}`,
        { method: "DELETE", companyId: COMPANY_ID },
      );
      expect(res.status, role).toBe(204);
      vi.unstubAllGlobals();
    }

    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });
});
