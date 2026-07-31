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
const OTHER_ID = "dddddddd-1111-4222-8333-444444444444";

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
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "member"),
  );
  return sb;
}

/**
 * #461: curating the shared set is admin's now. Writes run as an admin; the
 * LIST still runs as a plain member, because using a saved reply is what a
 * crew does all day and that had to stay theirs.
 */
function adminStub(): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "admin"),
  );
  return sb;
}

describe("templates CRUD (#461: read is a member's, curating is admin's)", () => {
  it("lists, and names who last edited each one", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/templates", () => [
      {
        id: TEMPLATE_ID,
        name: "On my way",
        body: "Heading over now!",
        updated_by: MEMBER_ID,
      },
      // #419: an edit that predates the column, or one by somebody who has
      // since left. The name is omitted rather than shown as a uuid.
      { id: OTHER_ID, name: "Running late", body: "Sorry!", updated_by: null },
    ]);
    sb.on("GET", "/rest/v1/profiles", () => [
      { user_id: MEMBER_ID, display_name: "Sam" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/templates", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; updated_by_name: string | null }[];
    };
    expect(body.data[0].updated_by_name).toBe("Sam");
    expect(body.data[1].updated_by_name).toBeNull();

    // The list is the one read path, so it must hide soft-deleted rows.
    const listed = sb.find("GET", "/rest/v1/templates")[0];
    expect(listed.url.searchParams.get("deleted_at")).toBe("is.null");
  });

  it("creates with created_by = caller; 409s duplicate names", async () => {
    const sb = adminStub();
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
    const sb = adminStub();
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

  it("patches, records the editor, and audits the change", async () => {
    const sb = adminStub();
    // #419: the route reads the row BEFORE updating, because "what did it say
    // before" is the question asked after a price or a promise turns up in a
    // message nobody remembers writing.
    sb.on("GET", "/rest/v1/templates", () => [
      { id: TEMPLATE_ID, name: "On my way", body: "Old body" },
    ]);
    sb.on("PATCH", "/rest/v1/templates", (call) => [
      { id: TEMPLATE_ID, name: "On my way", ...(call.body as object) },
    ]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
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
      updated_by: auth.subject,
    });

    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      action: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(audit.action).toBe("template.updated");
    // NAME AND SHAPE, NEVER THE BODY — the rule routes/companies.ts already
    // applies to away_message. The words live in the row, which is now
    // recoverable; the log says who changed them and by how much.
    expect(audit.before).toEqual({ name: "On my way", body_length: 8 });
    expect(audit.after.body_length).toBe(7);
    expect(JSON.stringify(audit)).not.toContain("Updated");
  });

  it("deletes SOFTLY, so an accidental delete is recoverable", async () => {
    const sb = adminStub();
    // The delete is an UPDATE now. Templates were the one shared object in
    // this codebase that simply ceased to exist, while tasks (D17) and
    // attachments (D19) both mark deleted_at.
    sb.on("PATCH", "/rest/v1/templates", (call) => [
      {
        id: TEMPLATE_ID,
        name: "On my way",
        body: "Heading over now.",
        ...(call.body as object),
      },
    ]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const del = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/templates/${TEMPLATE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(del.status).toBe(204);

    // No DELETE was ever issued: the stub has no handler for one, so a hard
    // delete would have failed the request rather than passing quietly.
    const wrote = sb.find("PATCH", "/rest/v1/templates")[0].body as {
      deleted_at: string;
      updated_by: string;
    };
    expect(typeof wrote.deleted_at).toBe("string");
    expect(wrote.updated_by).toBe(auth.subject);

    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      action: string;
      target_type: string;
    };
    expect(audit.action).toBe("template.deleted");
    expect(audit.target_type).toBe("template");
  });

  it("404s an unknown id on both writes", async () => {
    const sb2 = adminStub();
    sb2.on("GET", "/rest/v1/templates", () => []);
    sb2.on("PATCH", "/rest/v1/templates", () => []);
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

  it("#461: a member may USE saved replies but not curate them", async () => {
    // The founder asked whether this should be more granular. It should: a
    // template is words the whole crew sends in the business's name, which is
    // the same class of thing as the away message and the voicemail greeting,
    // both already admin. One member's edit changes what everyone sends.
    const sb = memberStub();
    sb.on("GET", "/rest/v1/templates", () => []);
    sb.on("POST", "/rest/v1/templates", () => []);
    sb.on("PATCH", "/rest/v1/templates", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    // Reading is theirs, and stays theirs — the "/" picker depends on it.
    const list = await apiRequest(app, env, await auth.token(), "/v1/templates", {
      companyId: COMPANY_ID,
    });
    expect(list.status).toBe(200);

    for (const [method, path, body] of [
      ["POST", "/v1/templates", { name: "N", body: "B" }],
      ["PATCH", `/v1/templates/${TEMPLATE_ID}`, { name: "N" }],
      ["DELETE", `/v1/templates/${TEMPLATE_ID}`, undefined],
    ] as const) {
      const res = await apiRequest(app, env, await auth.token(), path, {
        method,
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});
