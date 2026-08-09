/**
 * #227 — requesting and collecting a data export.
 *
 * The building itself is asserted in workspace/export.test.ts. What these pin
 * is the route's part: that an export is admin-only, that a second click does
 * not queue a second copy of everything, and that download links are minted
 * fresh rather than stored.
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
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { exportsRoutes } from "./exports";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const EXPORT_ID = "77777777-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(exportsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPORT_ID,
    // #581/C13: NOT NULL with a default in the schema, so a row without it is a state
    // production cannot produce — and the collect routes now decide per KIND who may
    // see a row, so a fixture missing it would make every one of them invisible and
    // read as a broken route rather than an incomplete fixture.
    kind: "workspace",
    status: "ready",
    storage_prefix: `${COMPANY_ID}/${EXPORT_ID}`,
    row_counts: { messages: 120, contacts: 8 },
    error: null,
    requested_at: "2026-07-26T00:00:00+00:00",
    completed_at: "2026-07-26T00:05:00+00:00",
    // Relative, not a literal date. `signFiles` compares this against
    // Date.now(), so a hardcoded "not yet" becomes a hardcoded "already gone"
    // the moment the clock passes it — this fixture read `2026-08-02` and the
    // suite went red on 2026-08-02 with no code change behind it.
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function world(
  options: { role?: string; rows?: Record<string, unknown>[]; request?: Record<string, unknown> } = {},
): { sb: SupabaseStub; routes: FetchRoute[] } {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "admin"),
  );
  // #581/C13: the collect routes ask the database for only the kinds this caller may
  // collect, so the stub answers the way PostgREST would — `kind=in.(a,b)` is applied,
  // not ignored. A stub that returned every row regardless would report the routes as
  // leaky-but-passing whether or not the filter was there.
  sb.on("GET", "/rest/v1/data_exports", (call) => {
    const rows = options.rows ?? [readyRow()];
    const filter = call.url.searchParams.get("kind");
    if (filter === null) return rows;
    const allowed = new Set(
      filter.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").filter(Boolean),
    );
    return rows.filter((row) => allowed.has(String(row.kind)));
  });
  sb.on("POST", "/rest/v1/rpc/request_data_export", () =>
    options.request ?? { outcome: "queued", export_id: EXPORT_ID },
  );
  sb.on("POST", "/rest/v1/audit_log", () => []);

  const storageRoute: FetchRoute = (url) => {
    if (!url.pathname.startsWith("/storage/v1/object")) return undefined;
    if (url.pathname.includes("/list/")) {
      return Response.json([{ name: "messages-0001.jsonl" }, { name: "manifest.json" }]);
    }
    return Response.json({ signedURL: "/object/sign/exports/x?token=sig" });
  };
  return { sb, routes: [storageRoute, sb.route] };
}

describe("POST /v1/exports", () => {
  it("queues one and records it as the privileged act it is", async () => {
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      method: "POST",
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      export_id: EXPORT_ID,
      already_building: false,
    });

    // #231: taking a copy of everything the business holds is the
    // departing-employee signature the audit log exists to catch.
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "contacts.exported",
      target_type: "data_export",
      target_id: EXPORT_ID,
    });
  });

  it("does not build a second copy of everything for a second click", async () => {
    // Cost protection: an export reads every row and writes a copy of it.
    const { sb, routes } = world({
      request: { outcome: "in_flight", export_id: EXPORT_ID },
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      method: "POST",
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      export_id: EXPORT_ID,
      already_building: true,
    });
    // Not a new privileged act — nothing new was requested.
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });

  it("is closed to ordinary members", async () => {
    // An export is a copy of every message and contact the business holds.
    const { sb, routes } = world({ role: "member" });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      method: "POST",
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/request_data_export")).toHaveLength(0);
  });
});

describe("GET /v1/exports", () => {
  it("mints a download link per file, fresh", async () => {
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; files: { name: string }[] }[];
    };
    expect(body.data[0].status).toBe("ready");
    expect(body.data[0].files.map((file) => file.name)).toEqual([
      "messages-0001.jsonl",
      "manifest.json",
    ]);
  });

  it("#581/C13: a bookkeeper collects the usage summary they asked for", async () => {
    /**
     * The usage summary sits behind `billing.manage` on purpose — it counts messages,
     * minutes and money and names nobody — and `bookkeeper` exists precisely to pair
     * that with no access to the inbox, so somebody's accountant can see the bill
     * without reading a customer's texts.
     *
     * Both collect routes were gated on `contacts.bulk`, which a bookkeeper does not
     * hold. So they could START the export built for them and then had no way to list
     * it or download it: the file was written, charged for, and unreachable by the only
     * role that wanted it.
     */
    const { routes } = world({
      role: "bookkeeper",
      rows: [readyRow({ kind: "usage_summary" })],
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; files: { name: string }[] }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].files.length).toBeGreaterThan(0);
  });

  it("#581/C13: and never anybody else's customer data", async () => {
    // The reason this is decided per row rather than by loosening the route: a
    // workspace export is a copy of every message and contact, conversation history
    // quotes what people wrote, and every task hangs off a conversation (D17) so a task
    // list names customers too. A bookkeeper must see none of the three.
    for (const kind of ["workspace", "conversation_history", "tasks"]) {
      const { routes } = world({
        role: "bookkeeper",
        rows: [readyRow({ kind })],
      });
      stubFetch(jwksRoute(auth), ...routes);

      const list = await apiRequest(app, env, await auth.token(), "/v1/exports", {
        companyId: COMPANY_ID,
      });
      expect(list.status, kind).toBe(200);
      expect((await list.json()) as { data: unknown[] }, kind).toMatchObject({
        data: [],
      });

      // And by id: the same answer as an id that does not exist, so the reply never
      // confirms that this workspace holds an export of a kind they may not collect.
      const byId = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/exports/${EXPORT_ID}`,
        { companyId: COMPANY_ID },
      );
      expect(byId.status, kind).toBe(404);
    }
  });

  it("#581/C13: an unrecognised kind is collected by nobody", async () => {
    // Fails closed. A new export kind is invisible until somebody decides who may
    // collect it — the alternative is a new kind of customer data readable by whoever
    // the default happened to favour.
    const { routes } = world({
      role: "owner",
      rows: [readyRow({ kind: "something_new" })],
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [] });
  });

  it("offers no links for an expired export", async () => {
    // The objects are gone. A link that 404s is worse than an explanation.
    const { routes } = world({
      rows: [readyRow({ expires_at: "2020-01-01T00:00:00+00:00" })],
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as { data: { files: unknown[] }[] };
    expect(body.data[0].files).toEqual([]);
  });

  it("offers no links for one still building, and says why it failed", async () => {
    const { routes } = world({
      rows: [
        readyRow({ status: "running", completed_at: null, expires_at: null }),
        readyRow({ status: "failed", error: "messages read failed" }),
      ],
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as {
      data: { status: string; error: string | null; files: unknown[] }[];
    };
    expect(body.data[0].files).toEqual([]);
    expect(body.data[1].error).toBe("messages read failed");
  });
});

/**
 * #304 — asking for one customer's history.
 *
 * HR-2 is the one to read twice. An audit row saying only "an export happened"
 * does not answer the question an owner asks after somebody leaves: WHICH
 * customer's correspondence left the building. The row has to name them.
 */
/**
 * #304 — the bookkeeper's usage export.
 *
 * UR-2 is the one to read twice. This endpoint is gated on `billing.manage`
 * and NOT on `contacts.bulk`, and the two tests below pull in opposite
 * directions on purpose: the bookkeeper must get in, and a member must not.
 * Gating it like the history export next door would have locked out the only
 * person it was built for.
 */
/**
 * #304 — exporting the work.
 *
 * TR-2 is the point. A task list reads like internal admin, so the tempting
 * gate is `workspace.access` — and that would hand every member a list of
 * every customer with outstanding work, which is a customer list with extra
 * steps. It is gated like the history export instead.
 */
describe("POST /v1/exports/tasks (#304)", () => {
  it("TR-1: asks for the task kind, and passes the filters through", async () => {
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z", state: "open" },
    });
    expect(res.status).toBe(202);

    const sent = sb.find("POST", "/rest/v1/rpc/request_data_export")[0]
      .body as Record<string, unknown>;
    expect(sent.p_kind).toBe("tasks");
    expect(sent.p_filters).toEqual({ from: "2026-06-01T00:00:00Z", state: "open" });
  });

  it("TR-2: a member cannot take the workspace's customer list", async () => {
    // The gate that matters. Every task names a customer, so this is
    // `contacts.bulk` — the same axis as exporting a thread.
    const { routes } = world({ role: "member" });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it("TR-3: an unknown state is refused rather than ignored", async () => {
    // Silently ignoring it would produce a file containing finished work for
    // somebody who asked for what is outstanding.
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { state: "in_progress" },
    });
    expect(res.status).toBe(422);
  });

  it("TR-4: refuses a period that ends before it starts", async () => {
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-30T00:00:00Z", to: "2026-06-01T00:00:00Z" },
    });
    expect(res.status).toBe(422);
  });

  it("TR-5: the audit row says WHAT was taken", async () => {
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { state: "open" },
    });

    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    const row = (audit.body as Record<string, unknown>[])[0] ??
      (audit.body as Record<string, unknown>);
    expect(JSON.stringify(row)).toContain("tasks");
    expect(JSON.stringify(row)).toContain("open");
  });

  it("TR-6: an unfiltered export means all work, not none", async () => {
    // An empty body is valid: "everything" is what an unfiltered export of the
    // work means, and requiring a period would be friction for the common case.
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/tasks", {
      method: "POST",
      companyId: COMPANY_ID,
      body: {},
    });
    expect(res.status).toBe(202);
  });
});

describe("POST /v1/exports/usage (#304)", () => {
  it("UR-1: asks for the usage kind, and passes the period through", async () => {
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z", to: "2026-06-30T23:59:59Z" },
    });
    expect(res.status).toBe(202);

    const sent = sb.find("POST", "/rest/v1/rpc/request_data_export")[0]
      .body as Record<string, unknown>;
    expect(sent.p_kind).toBe("usage_summary");
    expect(sent.p_filters).toEqual({
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-30T23:59:59Z",
    });
  });

  it("UR-2: the BOOKKEEPER can take it, a member cannot", async () => {
    // The capability choice, asserted from both sides. `bookkeeper` holds
    // billing.manage and not contacts.bulk; a member holds neither.
    const allowed = world({ role: "bookkeeper" });
    stubFetch(jwksRoute(auth), ...allowed.routes);
    const yes = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z" },
    });
    expect(yes.status).toBe(202);

    const denied = world({ role: "member" });
    stubFetch(jwksRoute(auth), ...denied.routes);
    const no = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z" },
    });
    expect(no.status).toBe(403);
  });

  it("UR-3: a period needs a start", async () => {
    // Absent would mean "since the beginning of time" — a different document,
    // and one that would arrive under the heading of the month they asked for.
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { to: "2026-06-30T23:59:59Z" },
    });
    expect(res.status).toBe(422);
  });

  it("UR-4: refuses a period that ends before it starts", async () => {
    const { routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-30T00:00:00Z", to: "2026-06-01T00:00:00Z" },
    });
    expect(res.status).toBe(422);
  });

  it("UR-5: the audit row names the PERIOD, not merely that it happened", async () => {
    // "Who pulled our numbers, and for what period" is the question an owner
    // is entitled to be able to answer.
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z", to: "2026-06-30T23:59:59Z" },
    });

    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    const row = (audit.body as Record<string, unknown>[])[0] ??
      (audit.body as Record<string, unknown>);
    expect(JSON.stringify(row)).toContain("usage.exported");
    expect(JSON.stringify(row)).toContain("2026-06-01T00:00:00Z");
  });

  it("UR-6: a build already in flight is not started twice", async () => {
    const { routes } = world({
      request: { outcome: "in_flight", export_id: EXPORT_ID },
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/usage", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-06-01T00:00:00Z" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      export_id: EXPORT_ID,
      already_building: true,
    });
  });
});

describe("POST /v1/exports/history (#304)", () => {
  const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";

  it("HR-1: asks for the scoped kind, and passes the filters through", async () => {
    // The kind is what the queue dispatches on, and the filters are what the
    // builder reads. A request that dropped either would silently build the
    // whole workspace instead.
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { contact_id: CONTACT_ID, from: "2026-07-01T00:00:00Z", to: "2026-07-31T23:59:59Z" },
    });
    expect(res.status).toBe(202);

    const call = sb.find("POST", "/rest/v1/rpc/request_data_export")[0];
    const sent = call.body as Record<string, unknown>;
    expect(sent.p_kind).toBe("conversation_history");
    expect(sent.p_filters).toEqual({
      contact_id: CONTACT_ID,
      from: "2026-07-01T00:00:00Z",
      to: "2026-07-31T23:59:59Z",
    });
  });

  it("HR-2: the audit row names WHICH customer", async () => {
    // THE ONE THAT MATTERS. "An export happened" is not the question; "whose
    // correspondence left" is, and it is asked months later about somebody who
    // has since gone (#276).
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { contact_id: CONTACT_ID },
    });

    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    const row = (audit.body as Record<string, unknown>[])[0] ??
      (audit.body as Record<string, unknown>);
    expect(JSON.stringify(row)).toContain(CONTACT_ID);
    expect(JSON.stringify(row)).toContain("conversation_history");
  });

  it("HR-3: a plain member cannot take a customer's history out", async () => {
    // `contacts.bulk`, not `conversations.read`. The difference between
    // reading a thread and exporting it is that the export LEAVES — a
    // permanent copy outside the product and outside its access rules.
    const { routes } = world({ role: "member" });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { contact_id: CONTACT_ID },
    });
    expect(res.status).toBe(403);
  });

  it("HR-4: a second click does not queue a second copy", async () => {
    const { routes } = world({
      request: { outcome: "in_flight", export_id: EXPORT_ID },
    });
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { contact_id: CONTACT_ID },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      export_id: EXPORT_ID,
      already_building: true,
    });
  });

  it("HR-5: refuses a period that ends before it starts", async () => {
    // Not a 500 from the builder later. A backwards range is a typo somebody
    // can fix in the moment, and an export that came back empty an hour later
    // would read as "there were no messages".
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { contact_id: CONTACT_ID, from: "2026-07-31T00:00:00Z", to: "2026-07-01T00:00:00Z" },
    });
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/request_data_export")).toHaveLength(0);
  });

  it("HR-6: needs a contact — a history of nobody is the workspace dump", async () => {
    const { sb, routes } = world();
    stubFetch(jwksRoute(auth), ...routes);

    const res = await apiRequest(app, env, await auth.token(), "/v1/exports/history", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { from: "2026-07-01T00:00:00Z" },
    });
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/request_data_export")).toHaveLength(0);
  });
});
