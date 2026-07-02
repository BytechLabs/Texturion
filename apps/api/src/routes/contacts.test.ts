/**
 * Contact routes (SPEC §5, §7): trgm list filter, upsert semantics clearing
 * deleted_at, soft delete, CSV import (parsing, E.164 normalization,
 * opted_out handling, malformed rows), manual opt-out/revoke.
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
const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";

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
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    phone_e164: "+14165550199",
    name: "Jo Smith",
    address: null,
    notes: null,
    consent_source: null,
    consent_at: null,
    consent_attested_by: null,
    first_identification_sent_at: null,
    deleted_at: null,
    created_at: "2026-07-01T09:00:00+00:00",
    updated_at: "2026-07-01T09:00:00+00:00",
    ...overrides,
  };
}

function importForm(csv: string): FormData {
  const form = new FormData();
  form.append("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  return form;
}

describe("GET /v1/contacts", () => {
  it("composes the trgm q filter with soft-delete exclusion and keyset limit", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=smi&limit=10",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("deleted_at")).toBe("is.null");
    expect(call.url.searchParams.get("or")).toBe(
      "(name.ilike.*smi*,phone_e164.ilike.*smi*)",
    );
    expect(call.url.searchParams.get("limit")).toBe("11");
  });

  it("decorates rows with opted_out (G6 badge) and last_activity_at (conversation activity, never updated_at) via batched lookups", async () => {
    const OTHER_ID = "eeeeeeee-1111-4222-8333-444444444444";
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow(), // +14165550199
      contactRow({
        id: OTHER_ID,
        phone_e164: "+15125550105",
        name: "Rosa Delgado",
        created_at: "2026-06-30T09:00:00+00:00",
      }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: "+15125550105" },
    ]);
    // Two conversations for the first contact (newest wins — the route
    // orders last_message_at DESC and keeps the first per contact); none for
    // the second (→ null, the "no texting yet" table state).
    sb.on("GET", "/rest/v1/conversations", () => [
      { contact_id: CONTACT_ID, last_message_at: "2026-06-26T18:04:00+00:00" },
      { contact_id: CONTACT_ID, last_message_at: "2026-05-01T10:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; opted_out: boolean; last_activity_at: string | null }[];
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        id: CONTACT_ID,
        opted_out: false,
        last_activity_at: "2026-06-26T18:04:00+00:00",
      }),
      expect.objectContaining({
        id: OTHER_ID,
        opted_out: true,
        last_activity_at: null,
      }),
    ]);

    const lookup = sb.find("GET", "/rest/v1/opt_outs")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("revoked_at")).toBe("is.null");
    expect(lookup.url.searchParams.get("phone_e164")).toBe(
      "in.(+14165550199,+15125550105)",
    );

    const activity = sb.find("GET", "/rest/v1/conversations")[0];
    expect(activity.url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    expect(activity.url.searchParams.get("contact_id")).toBe(
      `in.(${CONTACT_ID},${OTHER_ID})`,
    );
    expect(activity.url.searchParams.get("order")).toBe(
      "last_message_at.desc",
    );
  });

  it("skips the opt-out and activity lookups entirely for an empty page", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], next_cursor: null });
    expect(sb.find("GET", "/rest/v1/opt_outs")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/conversations")).toHaveLength(0);
  });

  it("strips PostgREST/LIKE metacharacters from q", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts?q=${encodeURIComponent('a%b_("c"),d')}`,
      { companyId: COMPANY_ID },
    );
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("or")).toBe(
      "(name.ilike.*abcd*,phone_e164.ilike.*abcd*)",
    );
  });
});

describe("POST /v1/contacts (upsert semantics)", () => {
  it("normalizes the phone, upserts on (company_id, phone_e164), clears deleted_at", async () => {
    const sb = stubWithRole("member");
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "(416) 555-0199", name: "Jo Smith" },
    });
    expect(res.status).toBe(201);

    const upsert = sb.find("POST", "/rest/v1/contacts")[0];
    expect(upsert.body).toEqual({
      company_id: COMPANY_ID,
      phone_e164: "+14165550199",
      deleted_at: null,
      name: "Jo Smith",
    });
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );
    expect(upsert.headers.get("prefer")).toContain(
      "resolution=merge-duplicates",
    );
  });

  it("422s non-US/CA numbers (Caribbean, international, garbage)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    for (const phone of ["+12425550199", "+447911123456", "banana"]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: phone },
      });
      expect(res.status, phone).toBe(422);
    }
  });
});

describe("GET/PATCH/DELETE /v1/contacts/:id", () => {
  it("GET returns the contact with app-side opt-out state", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => [{ id: "1a2b3c4d-1111-4222-8333-444444444444" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: CONTACT_ID,
      opted_out: true,
    });
  });

  it("PATCH consent_attested stamps consent fields and writes a consent_attested event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => []); // no conversation yet
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { consent_attested: true, name: "Jo S." },
      },
    );
    expect(res.status).toBe(200);

    const update = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(update.name).toBe("Jo S.");
    expect(update.consent_source).toBe("attested");
    expect(typeof update.consent_at).toBe("string");
    expect(update.consent_attested_by).toBe(auth.subject);

    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "consent_attested",
        conversation_id: null, // contact-level event, no conversation exists
        actor_user_id: auth.subject,
      }),
    ]);
  });

  it("DELETE soft-deletes (deleted_at) and 404s an unknown id", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0];
    expect(typeof (patch.body as Record<string, unknown>).deleted_at).toBe(
      "string",
    );

    vi.unstubAllGlobals();
    const sb2 = stubWithRole("member");
    sb2.on("PATCH", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb2.route);
    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(missing.status).toBe(404);
  });
});

describe("POST /v1/contacts/import (O/A, CSV)", () => {
  it("403s a plain member (role gate)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone\n+14165550199\n"),
      },
    );
    expect(res.status).toBe(403);
  });

  it("imports, updates, and reports malformed + duplicate rows; opted_out=true creates import-source opt-outs and events", async () => {
    const sb = stubWithRole("admin");
    // Pre-existing contact check: +14165550100 already exists.
    sb.on("GET", "/rest/v1/contacts", () => [
      { phone_e164: "+14165550100" },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      }));
    });
    sb.on("GET", "/rest/v1/opt_outs", () => []); // none already active
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: "0abc0abc-1111-4222-8333-444444444444" }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "phone,name,address,opted_out",
      '4165550100,"Smith, Jo","1 Main St",',
      "416-555-0101,New Person,,TRUE",
      "not-a-phone,Bad Row,,",
      "+14165550100,Duplicate Of Row2,,", // same phone as row 2
      "+12425550199,Caribbean,,", // Bahamas — rejected
    ].join("\r\n");

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      imported: 1, // +14165550101
      updated: 1, // +14165550100 existed
      skipped: 3,
      errors: [
        { row: 4, reason: expect.stringContaining("invalid phone") },
        { row: 5, reason: expect.stringContaining("duplicate phone") },
        { row: 6, reason: expect.stringContaining("invalid phone") },
      ],
    });

    // Upsert payload: E.164-normalized, deleted_at cleared, only CSV columns.
    const upsert = sb.find("POST", "/rest/v1/contacts")[0];
    expect(upsert.body).toEqual([
      {
        company_id: COMPANY_ID,
        phone_e164: "+14165550100",
        deleted_at: null,
        name: "Smith, Jo",
        address: "1 Main St",
      },
      {
        company_id: COMPANY_ID,
        phone_e164: "+14165550101",
        deleted_at: null,
        name: "New Person",
        address: null,
      },
    ]);
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );

    // opted_out=true row → opt_outs upsert with source='import'.
    const optOuts = sb.find("POST", "/rest/v1/opt_outs")[0].body as unknown[];
    expect(optOuts).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        phone_e164: "+14165550101",
        source: "import",
        revoked_at: null,
      }),
    ]);
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "opted_out",
        payload: { phone_e164: "+14165550101", source: "import" },
      }),
    ]);
  });

  it("does not re-emit opt-out events for already-active opt-outs", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [
      { id: CONTACT_ID, phone_e164: "+14165550199" },
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [{ phone_e164: "+14165550199" }]);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: "0abc0abc-1111-4222-8333-444444444444" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,opted_out\n+14165550199,yes\n"),
      },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("422s when the file field or phone column is missing", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);

    const noFile = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: new FormData() },
    );
    expect(noFile.status).toBe(422);

    const noPhone = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("name\nJo\n"),
      },
    );
    expect(noPhone.status).toBe(422);
  });
});

describe("opt-out mark/revoke (SPEC §5)", () => {
  it("POST /v1/contacts/:id/opt-out writes a manual opt-out + event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []); // not currently opted out
    sb.on("POST", "/rest/v1/opt_outs", (call) => [
      { id: "0abc0abc-1111-4222-8333-444444444444", ...(call.body as object) },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { id: "aaaaaaaa-1111-4222-8333-444444444444" },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(201);
    const upsert = sb.find("POST", "/rest/v1/opt_outs")[0];
    expect(upsert.body).toMatchObject({
      phone_e164: "+14165550199",
      source: "manual",
      created_by: auth.subject,
      revoked_at: null,
    });
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "opted_out",
        // attaches to the contact's most recent conversation
        conversation_id: "aaaaaaaa-1111-4222-8333-444444444444",
        payload: { phone_e164: "+14165550199", source: "manual" },
      }),
    ]);
  });

  it("is idempotent: an active opt-out returns 200 with no new event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: "0abc0abc-1111-4222-8333-444444444444", phone_e164: "+14165550199" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("revoke (POST …/opt-out/revoke and DELETE …/opt-out) sets revoked_at + event; 404 when not opted out", async () => {
    for (const [method, path] of [
      ["POST", `/v1/contacts/${CONTACT_ID}/opt-out/revoke`],
      ["DELETE", `/v1/contacts/${CONTACT_ID}/opt-out`],
    ] as const) {
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
      sb.on("PATCH", "/rest/v1/opt_outs", (call) => [
        { id: "0abc0abc-1111-4222-8333-444444444444", ...(call.body as object) },
      ]);
      sb.on("GET", "/rest/v1/conversations", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(app, env, await auth.token(), path, {
        method,
        companyId: COMPANY_ID,
      });
      expect(res.status, `${method} ${path}`).toBe(200);
      const update = sb.find("PATCH", "/rest/v1/opt_outs")[0];
      expect(
        typeof (update.body as Record<string, unknown>).revoked_at,
      ).toBe("string");
      expect(update.url.searchParams.get("revoked_at")).toBe("is.null");
      const events = sb.find("POST", "/rest/v1/conversation_events")[0]
        .body as { type: string }[];
      expect(events.map((e) => e.type)).toEqual(["opt_out_revoked"]);
      vi.unstubAllGlobals();
    }

    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out/revoke`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });
});
