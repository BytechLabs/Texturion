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
    status: "ready",
    storage_prefix: `${COMPANY_ID}/${EXPORT_ID}`,
    row_counts: { messages: 120, contacts: 8 },
    error: null,
    requested_at: "2026-07-26T00:00:00+00:00",
    completed_at: "2026-07-26T00:05:00+00:00",
    expires_at: "2026-08-02T00:00:00+00:00",
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
  sb.on("GET", "/rest/v1/data_exports", () => options.rows ?? [readyRow()]);
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
