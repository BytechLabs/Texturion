/**
 * Attachment routes (SPEC §7; D19 / APP-FEATURES-V2 §2):
 *   - GET /v1/attachments/:id/url — signed URL for BOTH the generic (note/task)
 *     attachments table AND the MMS message_attachments table (the MMS path is
 *     kept intact), plus membership scoping / 404.
 *   - POST /v1/attachments — generic note/task upload: owner-ownership +
 *     company scoping, size/type/byte-sniff gates, per-owner soft cap, Storage
 *     upload, row insert, audit event.
 *   - GET /v1/attachments — list a single owner's live attachments.
 * Only global fetch (JWKS + PostgREST + Storage) is stubbed.
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
import { attachmentsRoutes } from "./attachments";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const ATTACHMENT_ID = "77777777-1111-4222-8333-444444444444";
const NOTE_ID = "11111111-2222-4333-8444-555555555555";
const TASK_ID = "22222222-3333-4444-8555-666666666666";
const CONV_ID = "33333333-4444-4555-8666-777777777777";

let auth: TestAuth;
const app = buildTestApp(attachmentsRoutes);

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

/** A 1×1 PNG's leading magic bytes (enough for the byte sniff). */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}

function uploadForm(
  ownerType: string,
  ownerId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): FormData {
  const form = new FormData();
  form.append("owner_type", ownerType);
  form.append("owner_id", ownerId);
  form.append(
    "file",
    new File([file.bytes.slice().buffer], file.name, { type: file.type }),
  );
  return form;
}

describe("GET /v1/attachments/:id/url", () => {
  it("mints a short-lived signed URL for a generic (task/note) attachment", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { storage_path: `${COMPANY_ID}/task/${TASK_ID}/uuid-quote.pdf` },
    ]);
    sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
      signedURL: `/object/sign/attachments/${COMPANY_ID}/task/x?token=sig`,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_at: string };
    expect(body.url).toContain("token=sig");

    // Generic arm is company-scoped and live-only; it signs the `attachments`
    // bucket and NEVER falls through to message_attachments.
    const lookup = sb.find("GET", "/rest/v1/attachments")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("deleted_at")).toBe("is.null");
    expect(sb.find("GET", "/rest/v1/message_attachments")).toHaveLength(0);
    const sign = sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0];
    expect(sign.path).toBe(
      `/storage/v1/object/sign/attachments/${COMPANY_ID}/task/${TASK_ID}/uuid-quote.pdf`,
    );
    // Generic TTL is 300s (D19 §2.5).
    expect(sign.body).toMatchObject({ expiresIn: 300 });
  });

  it("falls back to the MMS message_attachments arm (kept intact), 1-hour TTL", async () => {
    const sb = stubWithRole("member");
    // No generic row → fall through to the MMS table.
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/message_attachments", () => [
      { storage_path: `mms-media/${COMPANY_ID}/msg-1/0` },
    ]);
    sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
      signedURL: `/object/sign/mms-media/${COMPANY_ID}/msg-1/0?token=sig`,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const before = Date.now();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_at: string };
    expect(body.url).toContain("token=sig");
    const expires = new Date(body.expires_at).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 3595_000);
    expect(expires).toBeLessThanOrEqual(before + 3605_000);

    const lookup = sb.find("GET", "/rest/v1/message_attachments")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // Bucket prefix stripped for the Storage sign call.
    const sign = sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0];
    expect(sign.path).toBe(
      `/storage/v1/object/sign/mms-media/${COMPANY_ID}/msg-1/0`,
    );
    expect(sign.body).toMatchObject({ expiresIn: 3600 });
  });

  it("404s an attachment in neither table (company scoping) and malformed ids", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    for (const id of [ATTACHMENT_ID, "not-a-uuid"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/attachments/${id}/url`,
        { companyId: COMPANY_ID },
      );
      expect(res.status, id).toBe(404);
    }
    // No Storage call for a miss.
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("403s a non-member before touching anything", async () => {
    const sb = stubWithRole(null);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/attachments")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/message_attachments")).toHaveLength(0);
  });
});

describe("POST /v1/attachments (generic note/task upload, D19)", () => {
  it("uploads a task attachment: owner check, storage upload, row insert, audit event", async () => {
    const sb = stubWithRole("member");
    // Owner task in the caller's company, not deleted.
    sb.on("GET", "/rest/v1/tasks", () => [
      { conversation_id: CONV_ID, deleted_at: null },
    ]);
    // No existing attachments (under the cap).
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
      Key: "attachments/x",
    }));
    sb.on("POST", "/rest/v1/attachments", (call) => [
      {
        id: ATTACHMENT_ID,
        owner_type: "task",
        owner_id: TASK_ID,
        conversation_id: CONV_ID,
        file_name: "photo.png",
        content_type: "image/png",
        size_bytes: (call.body as { size_bytes: number }).size_bytes,
        created_at: "2026-07-02T10:00:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ owner_type: "task", owner_id: TASK_ID });
    // Never leaks storage_path in the response.
    expect(body).not.toHaveProperty("storage_path");

    // Task ownership was company-scoped.
    const ownerLookup = sb.find("GET", "/rest/v1/tasks")[0];
    expect(ownerLookup.url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    // Storage object key: {company}/{owner_type}/{owner_id}/{uuid}-{safe_name}.
    const upload = sb.find("POST", /^\/storage\/v1\/object\/attachments\//)[0];
    expect(upload.path).toMatch(
      new RegExp(
        `/storage/v1/object/attachments/${COMPANY_ID}/task/${TASK_ID}/[0-9a-f-]+-photo\\.png$`,
      ),
    );
    // Inserted row is company-scoped, denormalizes conversation_id, stamps uploader.
    const insert = sb.find("POST", "/rest/v1/attachments")[0];
    const inserted = insert.body as Record<string, unknown>;
    expect(inserted).toMatchObject({
      company_id: COMPANY_ID,
      owner_type: "task",
      owner_id: TASK_ID,
      conversation_id: CONV_ID,
      content_type: "image/png",
      uploaded_by_user_id: auth.subject,
    });
    // A task_attachment_added audit event on the owner's conversation (D22).
    const event = (
      sb.find("POST", "/rest/v1/conversation_events")[0].body as Record<
        string,
        unknown
      >[]
    )[0];
    expect(event).toMatchObject({
      type: "task_attachment_added",
      conversation_id: CONV_ID,
      actor_user_id: auth.subject,
    });
  });

  it("writes a note_attachment_added event for owner_type=note", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "note" },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({ Key: "x" }));
    sb.on("POST", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        owner_id: NOTE_ID,
        conversation_id: CONV_ID,
        file_name: "spec.pdf",
        content_type: "application/pdf",
        size_bytes: 10,
        created_at: "2026-07-02T10:00:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("note", NOTE_ID, {
          name: "spec.pdf",
          type: "application/pdf",
          bytes: pdf,
        }),
      },
    );
    expect(res.status).toBe(201);
    const event = (
      sb.find("POST", "/rest/v1/conversation_events")[0].body as Record<
        string,
        unknown
      >[]
    )[0];
    expect(event).toMatchObject({ type: "note_attachment_added" });
  });

  it("404s an owner outside the caller's company (RLS scoping) before uploading", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tasks", () => []); // not found in this company
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(404);
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(0);
  });

  it("422s a disallowed declared type before any owner or storage work", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "run.exe",
          type: "application/x-msdownload",
          bytes: new Uint8Array([0x4d, 0x5a]),
        }),
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("GET", "/rest/v1/tasks")).toHaveLength(0);
  });

  it("422s when the bytes contradict the declared type (declared png, bytes pdf)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tasks", () => [
      { conversation_id: CONV_ID, deleted_at: null },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "fake.png",
          type: "image/png",
          bytes: pdfBytes,
        }),
      },
    );
    expect(res.status).toBe(422);
    // Never uploaded the mismatched bytes.
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(0);
  });

  it("422s an executable declared as an ALLOWED type (MZ bytes as application/pdf, D19 §2.3)", async () => {
    // The declared type is allow-listed, so it passes assertAllowedType and reaches
    // the byte re-check — the executable magic must be caught there, never trusted.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tasks", () => [
      { conversation_id: CONV_ID, deleted_at: null },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const mzBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // Windows PE
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "invoice.pdf",
          type: "application/pdf",
          bytes: mzBytes,
        }),
      },
    );
    expect(res.status).toBe(422);
    // Never uploaded the renamed executable, never inserted a row.
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/attachments")).toHaveLength(0);
  });

  it("422s at the soft per-owner cap of 10", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tasks", () => [
      { conversation_id: CONV_ID, deleted_at: null },
    ]);
    sb.on("GET", "/rest/v1/attachments", () =>
      Array.from({ length: 10 }, (_, i) => ({ id: `id-${i}` })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(422);
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(0);
  });

  it("422s a soft-deleted task owner (deleted_at set)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/tasks", () => [
      { conversation_id: CONV_ID, deleted_at: "2026-07-02T00:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("task", TASK_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/attachments (list one owner)", () => {
  it("lists a task's live attachments, company + owner scoped", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "task",
        owner_id: TASK_ID,
        conversation_id: CONV_ID,
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        created_at: "2026-07-02T10:00:00+00:00",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments?owner_type=task&owner_id=${TASK_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    const call = sb.find("GET", "/rest/v1/attachments")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("owner_type")).toBe("eq.task");
    expect(call.url.searchParams.get("owner_id")).toBe(`eq.${TASK_ID}`);
    expect(call.url.searchParams.get("deleted_at")).toBe("is.null");
  });

  it("422s a bad owner_type / missing owner_id", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    for (const qs of [
      "owner_type=bogus&owner_id=" + TASK_ID,
      "owner_type=task",
    ]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/attachments?${qs}`,
        { companyId: COMPANY_ID },
      );
      expect(res.status, qs).toBe(422);
    }
  });
});

describe("DELETE /v1/attachments/:id (soft-delete; sweep reclaims the object)", () => {
  it("soft-deletes a live task attachment, audits task_attachment_removed, returns 204", async () => {
    const sb = stubWithRole("member");
    // The soft-delete is a PATCH ...RETURNING; return the row it matched.
    sb.on("PATCH", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "task",
        conversation_id: CONV_ID,
        file_name: "quote.pdf",
      },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);

    // Company-scoped, live-only soft-delete (never a hard row delete here — the
    // sweep cron reclaims the Storage object after the grace window).
    const patch = sb.find("PATCH", "/rest/v1/attachments")[0];
    expect(patch.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(patch.url.searchParams.get("id")).toBe(`eq.${ATTACHMENT_ID}`);
    expect(patch.url.searchParams.get("deleted_at")).toBe("is.null");
    expect(patch.body).toMatchObject({ deleted_at: expect.any(String) });
    expect(sb.find("DELETE", "/rest/v1/attachments")).toHaveLength(0);

    const event = (
      sb.find("POST", "/rest/v1/conversation_events")[0].body as Record<
        string,
        unknown
      >[]
    )[0];
    expect(event).toMatchObject({
      type: "task_attachment_removed",
      conversation_id: CONV_ID,
      actor_user_id: auth.subject,
      payload: { attachment_id: ATTACHMENT_ID, file_name: "quote.pdf" },
    });
  });

  it("audits note_attachment_removed for a note-owned attachment", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        conversation_id: CONV_ID,
        file_name: "spec.pdf",
      },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const event = (
      sb.find("POST", "/rest/v1/conversation_events")[0].body as Record<
        string,
        unknown
      >[]
    )[0];
    expect(event).toMatchObject({ type: "note_attachment_removed" });
  });

  it("404s an id outside the company / already deleted (no event written)", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/attachments", () => []); // matched no live row
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });
});
