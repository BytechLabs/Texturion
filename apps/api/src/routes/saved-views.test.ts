/**
 * #280 — saved views.
 *
 * The properties worth pinning are the ones that would be silent if wrong: a
 * shared view must not become a permission grant, another member's personal
 * view must not be reachable by id, a stored filter the API no longer knows
 * must not 422 a screen the person cannot fix, and the count badge must be
 * bounded by construction rather than by how tidy the customer is.
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
import { savedViewsRoutes } from "./saved-views";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
/** The `sub` the harness mints tokens for — the CALLER, not their member row. */
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const OTHER_MEMBER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const VIEW_ID = "cccccccc-1111-4222-8333-444444444444";
const TAG_ID = "dddddddd-1111-4222-8333-444444444444";
const HIDDEN_NUMBER = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(savedViewsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

function viewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEW_ID,
    surface: "conversations",
    name: "My open threads",
    filters: { status: "open", assigned_user_id: USER_ID },
    position: 0,
    owner_user_id: USER_ID,
    created_by: USER_ID,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const token = () => auth.token();

describe("GET /v1/saved-views", () => {
  it("returns shared views and the caller's own, with their landing choice", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => [viewRow()]);
    sb.on("GET", "/rest/v1/company_members", () => [
      { default_conversation_view_id: VIEW_ID, default_task_view_id: null },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { shared: boolean; filters: unknown }[];
      defaults: Record<string, string | null>;
    };
    expect(body.data[0].shared).toBe(false);
    expect(body.defaults).toEqual({ conversations: VIEW_ID, tasks: null });

    // The list must never include another member's personal views. Their names
    // are free text they wrote.
    const call = sb.find("GET", "/rest/v1/saved_views")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("or")).toContain("owner_user_id.is.null");
  });

  it("drops a stored filter the API no longer knows, instead of failing", async () => {
    // A row written before a filter was renamed must still open. A 422 here is
    // a dead view on a screen the person has no way to repair.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ filters: { status: "open", colour: "red", q: "boiler" } }),
    ]);
    sb.on("GET", "/rest/v1/company_members", () => [
      { default_conversation_view_id: null, default_task_view_id: null },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { filters: unknown }[] };
    expect(body.data[0].filters).toEqual({ status: "open" });
  });
});

describe("POST /v1/saved-views", () => {
  it("lets a read-only member keep their own view", async () => {
    // Saving your own filters is read-side convenience. A role that can see the
    // inbox and cannot remember how it likes to look is not a useful role.
    const sb = stubWithRole("read_only");
    sb.on("POST", "/rest/v1/rpc/api_create_saved_view", () => ({
      outcome: "created",
      view: viewRow(),
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { surface: "conversations", name: "Mine", filters: { status: "open" } },
    });
    expect(res.status).toBe(201);
  });

  it("403s a plain member trying to save one for the whole crew", async () => {
    // A shared view is workspace configuration: it is how the owner encodes the
    // crew's process, and it appears on everybody's screen.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { surface: "conversations", name: "Emergency queue", shared: true },
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_create_saved_view")).toHaveLength(0);
  });

  it("stores only filters the list endpoint would accept", async () => {
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_create_saved_view", () => ({
      outcome: "created",
      view: viewRow(),
    }));
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await token(), "/v1/saved-views", {
      method: "POST",
      companyId: COMPANY_ID,
      body: {
        surface: "conversations",
        name: "Trimmed",
        // `cursor` is a position in one result set; `q` is a question asked
        // once; `overdue` belongs to the other surface entirely.
        filters: { status: "open", cursor: "abc", q: "boiler", overdue: true },
      },
    });
    const call = sb.find("POST", "/rest/v1/rpc/api_create_saved_view")[0];
    expect((call.body as { p_filters: unknown }).p_filters).toEqual({
      status: "open",
    });
  });

  it("turns the SQL cap and duplicate-name sentinels into 409s", async () => {
    for (const [outcome, extra] of [
      ["cap", { limit: 40 }],
      ["duplicate_name", {}],
    ] as const) {
      const sb = stubWithRole("admin");
      sb.on("POST", "/rest/v1/rpc/api_create_saved_view", () => ({
        outcome,
        ...extra,
      }));
      stubFetch(jwksRoute(auth), sb.route);
      const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
        method: "POST",
        companyId: COMPANY_ID,
        body: { surface: "conversations", name: "Whatever" },
      });
      expect(res.status, outcome).toBe(409);
      vi.unstubAllGlobals();
    }
  });

  it("422s an unknown surface and an empty name", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [
      { surface: "contacts", name: "X" },
      { surface: "conversations", name: "   " },
      { surface: "conversations", name: "x".repeat(61) },
    ]) {
      const res = await apiRequest(app, env, await token(), "/v1/saved-views", {
        method: "POST",
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("PATCH /v1/saved-views/:id", () => {
  it("404s somebody else's personal view, for an admin too", async () => {
    // Not 403: the view never appears on their list, so acknowledging it exists
    // would be telling them about a screen they cannot see. An admin editing it
    // would also be a change nobody can explain.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ owner_user_id: OTHER_MEMBER }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/${VIEW_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Mine now" } },
    );
    expect(res.status).toBe(404);
    expect(sb.find("PATCH", "/rest/v1/saved_views")).toHaveLength(0);
  });

  it("403s a plain member editing the crew's view", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ owner_user_id: null }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/${VIEW_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Renamed" } },
    );
    expect(res.status).toBe(403);
  });

  it("hands an un-shared view to whoever took it private", async () => {
    // Not to whoever created it. The person taking a crew view private is the
    // one who will keep using it, and the creator may have left.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ owner_user_id: null, created_by: OTHER_MEMBER }),
    ]);
    sb.on("PATCH", "/rest/v1/saved_views", () => [viewRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/${VIEW_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { shared: false } },
    );
    expect(res.status).toBe(200);
    const call = sb.find("PATCH", "/rest/v1/saved_views")[0];
    expect((call.body as { owner_user_id: string }).owner_user_id).toBe(USER_ID);
  });
});

describe("DELETE /v1/saved-views/:id", () => {
  it("403s a plain member deleting the crew's view, 204s their own", async () => {
    const shared = stubWithRole("member");
    shared.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ owner_user_id: null }),
    ]);
    stubFetch(jwksRoute(auth), shared.route);
    const refused = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/${VIEW_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(refused.status).toBe(403);
    vi.unstubAllGlobals();

    const own = stubWithRole("member");
    own.on("GET", "/rest/v1/saved_views", () => [viewRow()]);
    own.on("DELETE", "/rest/v1/saved_views", () => []);
    stubFetch(jwksRoute(auth), own.route);
    const ok = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/${VIEW_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(ok.status).toBe(204);
  });
});

describe("PUT /v1/saved-views/default", () => {
  it("refuses to land a member on a view they cannot see", async () => {
    // Without the visibility check a member could point their landing screen at
    // another member's personal view by id, and then read it every morning.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      "/v1/saved-views/default",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { surface: "conversations", view_id: VIEW_ID },
      },
    );
    expect(res.status).toBe(404);
    expect(sb.find("PATCH", "/rest/v1/company_members")).toHaveLength(0);
  });

  it("clears the landing view without a lookup", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/company_members", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      "/v1/saved-views/default",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { surface: "tasks", view_id: null },
      },
    );
    expect(res.status).toBe(200);
    const call = sb.find("PATCH", "/rest/v1/company_members")[0];
    expect(call.body).toEqual({ default_task_view_id: null });
  });
});

describe("GET /v1/saved-views/counts", () => {
  it("counts through the SAME list function the inbox calls", async () => {
    // The one place that could have cheated by counting rows directly. Under
    // #106 a badge computed any other way could be larger than the list it
    // labels, which is a leak rather than a rounding error.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => [
      viewRow({ filters: { status: "open", tag_id: TAG_ID, unread: true } }),
    ]);
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () =>
      Array.from({ length: 7 }, (_, i) => ({ id: String(i) })),
    );
    // A member with one number hidden — the case the badge must not leak.
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN_NUMBER, level: "none" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/counts?surface=conversations&ids=${VIEW_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: { [VIEW_ID]: 7 } });

    const call = sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0];
    const params = call.body as Record<string, unknown>;
    expect(params.p_status).toBe("open");
    expect(params.p_tag_id).toBe(TAG_ID);
    expect(params.p_unread).toBe(true);
    // Bounded: a badge stops counting rather than scanning a busy workspace.
    expect(params.p_limit).toBe(100);
    // #106/#368: the deny list travels with the count. A badge larger than the
    // list it labels would be telling a restricted member how many threads exist
    // on a number they cannot open, which is the leak #280 names explicitly.
    expect(params.p_hidden_number_ids).toEqual([HIDDEN_NUMBER]);
  });

  it("prices at most twelve views however many ids are asked for", async () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `cccccccc-1111-4222-8333-4444444444${String(i).padStart(2, "0")}`,
    );
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/saved_views", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/counts?surface=conversations&ids=${many.join(",")}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const call = sb.find("GET", "/rest/v1/saved_views")[0];
    const asked = call.url.searchParams.get("id") ?? "";
    expect(asked.split(",").length).toBeLessThanOrEqual(12);
  });

  it("returns nothing for tasks rather than a half-bounded second path", async () => {
    // Task views ship without a badge until their list can be counted with the
    // same ceiling. A partially-bounded second path is how the cost hole gets
    // reopened.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await token(),
      `/v1/saved-views/counts?surface=tasks&ids=${VIEW_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(await res.json()).toEqual({ counts: {} });
  });

  it("ignores junk ids without erroring", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await token(),
      "/v1/saved-views/counts?surface=conversations&ids=not-a-uuid,,x",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: {} });
  });
});
