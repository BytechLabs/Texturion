/**
 * Saved replies (SPEC §7, §10): member-level CRUD, name-conflict 409s.
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
import { templatesRoutes } from "./templates";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TEMPLATE_ID = "cccccccc-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(templatesRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function memberStub(): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  return sb;
}

describe("templates CRUD (member-level per §10)", () => {
  it("lists", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/templates", () => [
      { id: TEMPLATE_ID, name: "On my way", body: "Heading over now!" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/templates", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: TEMPLATE_ID, name: "On my way", body: "Heading over now!" }],
      next_cursor: null,
    });
  });

  it("creates as a plain member with created_by = caller; 409s duplicate names", async () => {
    const sb = memberStub();
    let first = true;
    sb.on("POST", "/rest/v1/templates", (call) => {
      if (first) {
        first = false;
        return [{ id: TEMPLATE_ID, ...(call.body as object) }];
      }
      return pgError("23505", "duplicate key value violates templates_name_uq");
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/templates", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { name: "On my way", body: "Heading over now!" },
    });
    expect(res.status).toBe(201);
    expect(sb.find("POST", "/rest/v1/templates")[0].body).toEqual({
      company_id: COMPANY_ID,
      name: "On my way",
      body: "Heading over now!",
      created_by: auth.subject,
    });

    const dup = await apiRequest(app, env, await auth.token(), "/v1/templates", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { name: "On my way", body: "again" },
    });
    expect(dup.status).toBe(409);
  });

  it("422s invalid create bodies", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [{}, { name: "x" }, { name: "", body: "hi" }]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/templates",
        { method: "POST", companyId: COMPANY_ID, body },
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it("patches and deletes; 404s unknown ids", async () => {
    const sb = memberStub();
    sb.on("PATCH", "/rest/v1/templates", (call) => [
      { id: TEMPLATE_ID, ...(call.body as object) },
    ]);
    sb.on("DELETE", "/rest/v1/templates", () => [{ id: TEMPLATE_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const patch = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/templates/${TEMPLATE_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { body: "Updated" } },
    );
    expect(patch.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/templates")[0].body).toEqual({
      body: "Updated",
    });

    const del = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/templates/${TEMPLATE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(del.status).toBe(204);

    vi.unstubAllGlobals();
    const sb2 = memberStub();
    sb2.on("PATCH", "/rest/v1/templates", () => []);
    sb2.on("DELETE", "/rest/v1/templates", () => []);
    stubFetch(jwksRoute(auth), sb2.route);
    for (const method of ["PATCH", "DELETE"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/templates/${TEMPLATE_ID}`,
        {
          method,
          companyId: COMPANY_ID,
          body: method === "PATCH" ? { name: "X" } : undefined,
        },
      );
      expect(res.status, method).toBe(404);
    }
  });
});
