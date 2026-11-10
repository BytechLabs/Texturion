/**
 * #695: contact tags, bulk actions, and the way back from a merge.
 *
 * What is pinned is what would fail quietly: a tag filter that returns
 * everybody, a bulk action that borrows another workspace's contact ids, a
 * member being able to do what only an admin can, and a delete that reports the
 * rows it never touched.
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

import { contactsRoutes } from "./contacts";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONTACT_A = "dddddddd-1111-4222-8333-444444444444";
const CONTACT_B = "dddddddd-2222-4222-8333-444444444444";
const STRANGER = "dddddddd-3333-4222-8333-444444444444";
const TAG_ID = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(contactsRoutes);

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

function contactRow(id: string) {
  return {
    id,
    phone_e164: "+14165550199",
    name: "Dana",
    created_at: "2026-07-01T00:00:00Z",
    created_by_user_id: null,
    updated_by_user_id: null,
  };
}

describe("GET /v1/contacts with a tag", () => {
  it("joins the link table on that tag and never leaks the join into the rows", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      { ...contactRow(CONTACT_A), contact_tags: [{ tag_id: TAG_ID }] },
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("GET", "/rest/v1/contact_tags", () => [
      { contact_id: CONTACT_A, tags: { id: TAG_ID, name: "Warranty", color: null } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts?tag_id=${TAG_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("select")).toContain("contact_tags!inner(tag_id)");
    expect(call.url.searchParams.get("contact_tags.tag_id")).toBe(`eq.${TAG_ID}`);
    expect(call.url.searchParams.get("merged_into")).toBe("is.null");

    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]).not.toHaveProperty("contact_tags");
    expect(body.data[0].tags).toEqual([
      { id: TAG_ID, name: "Warranty", color: null },
    ]);
  });

  it("refuses a tag id that is not an id, rather than ignoring it", async () => {
    // A filter that is silently dropped looks exactly like a workspace where
    // everybody carries the tag.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?tag_id=warranty",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
  });

  it("does not list a record that was merged away", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(
      sb.find("GET", "/rest/v1/contacts")[0].url.searchParams.get("merged_into"),
    ).toBe("is.null");
  });
});

describe("GET /v1/contacts/export with tags and a selection", () => {
  it("puts a contact's own tags in the tags column, beside its conversation tags", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        id: CONTACT_A,
        name: "Dana",
        phone_e164: "+14165550199",
        consent_source: null,
        consent_at: null,
        created_at: "2026-07-01T00:00:00Z",
      },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { contact_id: CONTACT_A, conversation_tags: [{ tags: { name: "Won" } }] },
    ]);
    sb.on("GET", "/rest/v1/contact_tags", () => [
      { contact_id: CONTACT_A, tags: { id: TAG_ID, name: "Property manager", color: null } },
    ]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/export?ids=${CONTACT_A},${CONTACT_B}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Won;Property manager");
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("id")).toBe(`in.(${CONTACT_A},${CONTACT_B})`);
  });

  it("refuses a selection that is not a list of ids", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export?ids=everyone",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /v1/contacts/:id", () => {
  it("names the record that was merged in, so Unmerge has something to act on", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", (call) => {
      if (call.url.searchParams.get("merged_into")) {
        return [
          {
            id: CONTACT_B,
            name: "Jane Smith",
            phone_e164: "+14165550100",
            merged_at: "2026-11-02T15:00:00Z",
          },
        ];
      }
      return [
        {
          ...contactRow(CONTACT_A),
          timezone: null,
          opted_out: false,
        },
      ];
    });
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("GET", "/rest/v1/contact_addresses", () => []);
    sb.on("GET", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), `/v1/contacts/${CONTACT_A}`, {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.merged_from).toMatchObject({ id: CONTACT_B, name: "Jane Smith" });
    expect(body.tags).toEqual([]);
  });
});

describe("POST /v1/contacts/:id/merge copies tags to the survivor", () => {
  it("adds the folded-in record's tags to the survivor and leaves its own", async () => {
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_merge_contacts", () => ({
      outcome: "merged",
      moved: 1,
      closed: 0,
      opted_out: false,
      from_phone: "+14155550501",
      into_phone: "+14155550502",
    }));
    sb.on("GET", "/rest/v1/contact_tags", () => [{ tag_id: TAG_ID }]);
    sb.on("POST", "/rest/v1/contact_tags", () => []);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_A}/merge`,
      { method: "POST", companyId: COMPANY_ID, body: { into_contact_id: CONTACT_B } },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/contact_tags")[0].body).toEqual([
      { company_id: COMPANY_ID, contact_id: CONTACT_B, tag_id: TAG_ID },
    ]);
  });
});

describe("POST /v1/contacts/:id/unmerge", () => {
  it("is an admin's call, like the merge it undoes", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_B}/unmerge`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_unmerge_contact")).toHaveLength(0);
  });
});

describe("POST /v1/contacts/:id/tags", () => {
  it("attaches an existing workspace tag", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow(CONTACT_A)]);
    sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID, name: "Warranty", color: null }]);
    sb.on("POST", "/rest/v1/contact_tags", () => [{ contact_id: CONTACT_A }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_A}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(res.status).toBe(201);
    expect(sb.find("POST", "/rest/v1/contact_tags")[0].body).toMatchObject({
      company_id: COMPANY_ID,
      contact_id: CONTACT_A,
      tag_id: TAG_ID,
    });
  });

  it("is a no-op the second time, not a duplicate", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow(CONTACT_A)]);
    sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID, name: "Warranty", color: null }]);
    sb.on("POST", "/rest/v1/contact_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_A}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(res.status).toBe(200);
  });

  it("answers a locked workspace's new tag with a forbidden, for a member", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow(CONTACT_A)]);
    sb.on("POST", "/rest/v1/rpc/api_find_or_create_tag", () => [
      { id: null, name: "x", color: null, refused: true, reason: "locked" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_A}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { name: "Brand new" } },
    );
    expect(res.status).toBe(403);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_find_or_create_tag")[0].body,
    ).toMatchObject({ p_may_create: false });
    expect(sb.find("POST", "/rest/v1/contact_tags")).toHaveLength(0);
  });

  it("will not tag a contact from another workspace", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${STRANGER}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/contact_tags")).toHaveLength(0);
  });
});

describe("DELETE /v1/contacts/:id/tags/:tag_id", () => {
  it("detaches, scoped to the caller's workspace", async () => {
    const sb = stubWithRole("member");
    sb.on("DELETE", "/rest/v1/contact_tags", () => [{ tag_id: TAG_ID }]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_A}/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    expect(
      sb.find("DELETE", "/rest/v1/contact_tags")[0].url.searchParams.get("company_id"),
    ).toBe(`eq.${COMPANY_ID}`);
  });
});

describe("POST /v1/contacts/bulk", () => {
  it("tags only the contacts that do not carry the tag yet, and reports exactly those", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_A }, { id: CONTACT_B }]);
    sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID }]);
    sb.on("GET", "/rest/v1/contact_tags", () => [{ contact_id: CONTACT_A }]);
    sb.on("POST", "/rest/v1/contact_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { action: "add_tag", ids: [CONTACT_A, CONTACT_B], tag_id: TAG_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applied: { id: string; previous: unknown }[];
      failed: unknown[];
    };
    // A is already tagged, so it is not "applied": an undo built from this
    // response must never strip a tag somebody already had.
    expect(body.applied).toEqual([{ id: CONTACT_B, previous: { tagged: false } }]);
    expect(sb.find("POST", "/rest/v1/contact_tags")[0].body).toEqual([
      { company_id: COMPANY_ID, contact_id: CONTACT_B, tag_id: TAG_ID },
    ]);
  });

  it("untags, reporting the rows that had the tag", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_A }, { id: CONTACT_B }]);
    sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID }]);
    sb.on("GET", "/rest/v1/contact_tags", () => [{ contact_id: CONTACT_A }]);
    sb.on("DELETE", "/rest/v1/contact_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { action: "remove_tag", ids: [CONTACT_A, CONTACT_B], tag_id: TAG_ID },
    });
    const body = (await res.json()) as { applied: { id: string }[] };
    expect(body.applied.map((row) => row.id)).toEqual([CONTACT_A]);
    const call = sb.find("DELETE", "/rest/v1/contact_tags")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("contact_id")).toBe(`in.(${CONTACT_A})`);
  });

  it("will not act on an id that is not this workspace's, and says so", async () => {
    const sb = stubWithRole("member");
    // The lookup is scoped to the caller's company, so a borrowed id is
    // simply absent from the answer.
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_A }]);
    sb.on("GET", "/rest/v1/tags", () => [{ id: TAG_ID }]);
    sb.on("GET", "/rest/v1/contact_tags", () => []);
    sb.on("POST", "/rest/v1/contact_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { action: "add_tag", ids: [CONTACT_A, STRANGER], tag_id: TAG_ID },
    });
    const body = (await res.json()) as {
      applied: { id: string }[];
      failed: { id: string; reason: string }[];
    };
    expect(body.failed).toEqual([{ id: STRANGER, reason: "not_found" }]);
    expect(body.applied.map((row) => row.id)).toEqual([CONTACT_A]);
    expect(
      sb.find("GET", "/rest/v1/contacts")[0].url.searchParams.get("company_id"),
    ).toBe(`eq.${COMPANY_ID}`);
  });

  it("refuses a tag that is not this workspace's", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_A }]);
    sb.on("GET", "/rest/v1/tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { action: "add_tag", ids: [CONTACT_A], tag_id: TAG_ID },
    });
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/contact_tags")).toHaveLength(0);
  });

  it("soft-deletes the selection, reporting only the rows it touched", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_A }]);
    sb.on("PATCH", "/rest/v1/contacts", () => [{ id: CONTACT_A }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { action: "delete", ids: [CONTACT_A, STRANGER] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applied: { id: string }[];
      failed: { id: string }[];
    };
    expect(body.applied.map((row) => row.id)).toEqual([CONTACT_A]);
    expect(body.failed.map((row) => row.id)).toEqual([STRANGER]);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0];
    expect(patch.body).toMatchObject({ deleted_by_user_id: expect.any(String) });
    expect(patch.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // Only the live ones are named: a stranger's id never reaches the write.
    expect(patch.url.searchParams.get("id")).toBe(`in.(${CONTACT_A})`);
  });

  it("is not a read-only member's call, for tagging or for deleting", async () => {
    for (const role of ["read_only", null]) {
      const sb = stubWithRole(role);
      stubFetch(jwksRoute(auth), sb.route);
      for (const body of [
        { action: "delete", ids: [CONTACT_A] },
        { action: "add_tag", ids: [CONTACT_A], tag_id: TAG_ID },
      ]) {
        const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
          method: "POST",
          companyId: COMPANY_ID,
          body,
        });
        expect(res.status).toBeGreaterThanOrEqual(403);
      }
      expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
      expect(sb.find("POST", "/rest/v1/contact_tags")).toHaveLength(0);
    }
  });

  it("refuses a selection that is empty, over the cap, or a tag action with no tag", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const tooMany = Array.from({ length: 201 }, (_, i) =>
      `dddddddd-0000-4222-8333-${String(i).padStart(12, "0")}`,
    );
    for (const body of [
      { action: "delete", ids: [] },
      { action: "delete", ids: tooMany },
      { action: "add_tag", ids: [CONTACT_A] },
      { action: "send", ids: [CONTACT_A] },
    ]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/contacts/bulk", {
        method: "POST",
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status).toBe(422);
    }
  });
});
