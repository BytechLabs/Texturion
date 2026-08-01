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
    "POST",
    "/rest/v1/rpc/api_authorize_request",
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
      // #354: the handler reads the row first, to see whether it is a pipeline
      // stage. An ordinary tag carries none and deletes as it always did.
      sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID, pipeline_stage: null }]);
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
    sb.on("GET", "/rest/v1/tags", () => []);
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

describe("#354 deleting a pipeline stage", () => {
  it("refuses without an explicit confirmation, and says what would be lost", async () => {
    // The gate is on the ROUTE rather than in a client dialog, because a client
    // dialog exempts the mobile apps, any future integration, and curl.
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/tags", () => [
      { id: TAG_ID, pipeline_stage: "won" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("stop counting");
    // Nothing was deleted while the question was being asked.
    expect(sb.find("DELETE", "/rest/v1/tags")).toHaveLength(0);
  });

  it("goes through when the caller confirms", async () => {
    // #354 is explicit that stages must not be locked: a crew that wants a
    // different pipeline should be able to have one, deliberately.
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/tags", () => [
      { id: TAG_ID, pipeline_stage: "won" },
    ]);
    sb.on("DELETE", "/rest/v1/tags", () => [{ id: TAG_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}?confirm_pipeline=true`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
  });

  it("does not gate a RENAME, because nothing reads the name", async () => {
    // The whole design: the stage key is what the saved view and the report
    // key on, so renaming "Quote sent" to "Quoted" breaks nothing and should
    // meet no friction at all.
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/tags", () => [
      { id: TAG_ID, name: "Quoted", pipeline_stage: "quote_sent" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Quoted" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pipeline_stage: "quote_sent" });
  });
});

describe("#298 GET /v1/tags/usage", () => {
  it("reports the count and last-used date any member can act on", async () => {
    // Seeing that "warranty" has 40 uses and "wrnty" has 2 is what stops
    // somebody attaching the wrong one, and that is everybody's problem —
    // hence member-readable rather than admin-only.
    const sb = stubWithRole("member");
    sb.on("POST", "/rest/v1/rpc/api_tag_usage", () => [
      { tag_id: TAG_ID, name: "Warranty", uses: 40, last_used: "2026-08-01T00:00:00Z" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/tags/usage", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { uses: number }[] };
    expect(body.data[0].uses).toBe(40);
  });
});

describe("#298 POST /v1/tags/:id/merge", () => {
  const INTO = "cccccccc-1111-4222-8333-444444444444";

  it("403s a plain member", async () => {
    // A merge rewrites how a workspace's history is categorised and, unlike a
    // rename, cannot be undone by typing the old name back.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}/merge`,
      { method: "POST", companyId: COMPANY_ID, body: { into_tag_id: INTO } },
    );
    expect(res.status).toBe(403);
  });

  it("reports what moved, including the threads that carried both", async () => {
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_merge_tags", () => ({
      outcome: "merged",
      moved: 12,
      already_both: 3,
      stage_moved: false,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}/merge`,
      { method: "POST", companyId: COMPANY_ID, body: { into_tag_id: INTO } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ merged: true, moved: 12, already_both: 3 });
  });

  it("409s two pipeline stages, and says what would have been lost", async () => {
    // #354/D108: the survivor can carry one stage, so merging two would throw
    // away a win-rate category — the expensive direction to be wrong in.
    const sb = stubWithRole("owner");
    sb.on("POST", "/rest/v1/rpc/api_merge_tags", () => ({
      outcome: "two_stages",
      from_stage: "won",
      into_stage: "lost",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tags/${TAG_ID}/merge`,
      { method: "POST", companyId: COMPANY_ID, body: { into_tag_id: INTO } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("win-rate");
  });

  it("422s a merge into itself, and 404s an unknown tag", async () => {
    for (const [outcome, status] of [
      ["same_tag", 422],
      ["not_found", 404],
    ] as const) {
      const sb = stubWithRole("owner");
      sb.on("POST", "/rest/v1/rpc/api_merge_tags", () => ({ outcome }));
      stubFetch(jwksRoute(auth), sb.route);
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/tags/${TAG_ID}/merge`,
        { method: "POST", companyId: COMPANY_ID, body: { into_tag_id: INTO } },
      );
      expect(res.status, outcome).toBe(status);
      vi.unstubAllGlobals();
    }
  });
});
