/**
 * Attachment routes (SPEC §7; D19 / D28 / D30 / APP-FEATURES-V2 §2):
 *   - GET /v1/attachments/:id/url — signed URL for BOTH the generic (note and
 *     legacy task) attachments table AND the MMS message_attachments table
 *     (the MMS path is kept intact), plus membership scoping / 404, plus the
 *     #16 egress claim: every mint atomically claims the object's size_bytes
 *     against the FIXED 200 GB monthly allowance (#121) BEFORE signing (402
 *     usage_cap_reached over the allowance; a claim error mints nothing).
 *   - POST /v1/attachments — NOTES-ONLY upload (D28: owner_type='task' is a
 *     422 — task attachments are a derived read view now): owner-ownership +
 *     company scoping, size/type/byte-sniff gates, per-owner soft cap, the
 *     atomic claim RPC called FIRST with an UNBOUNDED budget (#121: storage
 *     is free — uploads never 409 on storage), Storage upload with claim
 *     release on failure, audit event.
 *   - GET /v1/attachments — list a single owner's live attachments (note OR
 *     task — legacy task rows keep reading).
 *   - DELETE /v1/attachments/:id — soft-delete, note or legacy task.
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
  // #121: NO company_modules stub — the storage budgets (and their module
  // resolution) are retired; a read would fail loudly as unstubbed.
  // #106: the access guards resolve number_access for members; [] = no rules →
  // unrestricted, so the guard short-circuits and these assertions are
  // unchanged. Tests that exercise a hidden number stub this route explicitly.
  sb.on("GET", "/rest/v1/number_access", () => []);
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
  /** Company billing-period anchor the #16 egress window is keyed on. */
  const PERIOD_START = "2026-07-01T00:00:00+00:00";
  /** #121: the FIXED 200 GB per-period pool every plan gets. */
  const EGRESS_ALLOWANCE = 200 * 1024 * 1024 * 1024;

  /**
   * The #16 egress-claim stubs every successful mint needs: the company's
   * plan + period anchor and the atomic claim_signed_url_egress RPC (which
   * mimics the SQL: usedBytes + p_bytes vs p_limit_bytes).
   */
  function egressStubs(
    sb: SupabaseStub,
    options: { usedBytes?: number; periodStart?: string | null } = {},
  ) {
    sb.on("GET", "/rest/v1/companies", () => [
      {
        plan: "starter",
        current_period_start:
          options.periodStart === undefined ? PERIOD_START : options.periodStart,
      },
    ]);
    sb.on("POST", "/rest/v1/rpc/claim_signed_url_egress", (call) => {
      const p = call.body as { p_bytes: number; p_limit_bytes: number };
      const used = options.usedBytes ?? 0;
      if (used + p.p_bytes > p.p_limit_bytes) {
        return { allowed: false, used_bytes: used };
      }
      return { allowed: true, used_bytes: used + p.p_bytes };
    });
  }

  it("mints a short-lived signed URL for a generic (task/note) attachment, claiming egress first", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { storage_path: `${COMPANY_ID}/task/${TASK_ID}/uuid-quote.pdf`, size_bytes: 2048 },
    ]);
    egressStubs(sb);
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

    // #16: the mint claimed the object's bytes against the fixed allowance
    // (#121), keyed on the billing period, BEFORE the sign call.
    const claim = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")[0];
    expect(claim.body).toEqual({
      p_company_id: COMPANY_ID,
      p_since: PERIOD_START,
      p_bucket: "attachments",
      p_bytes: 2048,
      p_limit_bytes: EGRESS_ALLOWANCE,
    });
    const order = sb.calls.map((call) => call.path);
    expect(order.indexOf("/rest/v1/rpc/claim_signed_url_egress")).toBeLessThan(
      order.findIndex((path) => path.startsWith("/storage/v1/object/sign/")),
    );
  });

  it("falls back to the MMS message_attachments arm (kept intact), 1-hour TTL; a NULL size claims 0", async () => {
    const sb = stubWithRole("member");
    // No generic row → fall through to the MMS table.
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/message_attachments", () => [
      { storage_path: `mms-media/${COMPANY_ID}/msg-1/0`, size_bytes: null },
    ]);
    egressStubs(sb);
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
    // MMS media draws on the same egress pool; a legacy NULL size claims 0.
    const claim = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")[0];
    expect(claim.body).toMatchObject({ p_bucket: "mms-media", p_bytes: 0 });
  });

  it("402s usage_cap_reached over the egress allowance — no URL is signed (#16)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-photo.png`,
        size_bytes: 25 * 1024 * 1024,
      },
    ]);
    // Allowance already fully spent (200 GB burnt, #121) → the claim refuses
    // the mint.
    egressStubs(sb, { usedBytes: EGRESS_ALLOWANCE });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("usage_cap_reached");
    expect(body.error.message).toContain("200 GB");
    // Cap-and-drop: over the allowance, NOTHING is signed.
    expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)).toHaveLength(0);
  });

  it("mints NO URL when the egress claim errors (fail closed, #16)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-photo.png`, size_bytes: 64 },
    ]);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "starter", current_period_start: PERIOD_START },
    ]);
    sb.on(
      "POST",
      "/rest/v1/rpc/claim_signed_url_egress",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(500);
    expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)).toHaveLength(0);
  });

  it("falls back to the current UTC calendar month when the company has no billing period", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-photo.png`, size_bytes: 64 },
    ]);
    egressStubs(sb, { periodStart: null });
    sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
      signedURL: `/object/sign/attachments/x?token=sig`,
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
    const claim = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")[0];
    const now = new Date();
    expect((claim.body as { p_since: string }).p_since).toBe(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    );
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
    // No Storage call and no egress claim for a miss.
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")).toHaveLength(0);
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

describe("POST /v1/attachments (generic upload — notes-only, D19/D28/#121)", () => {
  /**
   * Stubs shared by every upload that gets past validation: the note owner,
   * the per-owner cap count, and the atomic claim_attachment_storage RPC.
   * #121: storage is free — the Worker passes an UNBOUNDED budget
   * (Number.MAX_SAFE_INTEGER) and never reads the company plan on this path
   * (no companies stub — a read would fail loudly). The RPC stub still
   * mirrors the SQL's re-sum-vs-budget math (`storedBytes` = the live bytes
   * it would re-sum) so these tests PROVE the unbounded budget makes a
   * rejection unreachable, rather than assuming it.
   */
  function uploadStubs(
    sb: SupabaseStub,
    options: { storedBytes?: number } = {},
  ) {
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "note" },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("POST", "/rest/v1/rpc/claim_attachment_storage", (call) => {
      const p = call.body as { p_size_bytes: number; p_budget_bytes: number };
      const used = options.storedBytes ?? 0;
      if (used + p.p_size_bytes > p.p_budget_bytes) return { allowed: false };
      return {
        allowed: true,
        attachment: {
          id: ATTACHMENT_ID,
          company_id: COMPANY_ID,
          owner_type: "note",
          owner_id: NOTE_ID,
          conversation_id: CONV_ID,
          storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-photo.png`,
          file_name: "photo.png",
          content_type: "image/png",
          size_bytes: p.p_size_bytes,
          uploaded_by_user_id: MEMBER_ID,
          created_at: "2026-07-02T10:00:00+00:00",
          deleted_at: null,
        },
      };
    });
  }

  it("uploads a note attachment: owner check, storage upload, atomic budget claim, audit event", async () => {
    const sb = stubWithRole("member");
    uploadStubs(sb, { storedBytes: 1024 });
    sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
      Key: "attachments/x",
    }));
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
        rawBody: uploadForm("note", NOTE_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ owner_type: "note", owner_id: NOTE_ID });
    // Never leaks storage_path (the RPC returns to_jsonb of the full row; the
    // route projects to the API columns).
    expect(body).not.toHaveProperty("storage_path");
    expect(body).not.toHaveProperty("uploaded_by_user_id");

    // Note ownership was company-scoped.
    const ownerLookup = sb.find("GET", "/rest/v1/messages")[0];
    expect(ownerLookup.url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    // #15 claim-first ordering: the accounting claim precedes the Storage
    // upload, so a failed upload can never orphan an unaccounted object.
    const order = sb.calls.map((call) => call.path);
    expect(order.indexOf("/rest/v1/rpc/claim_attachment_storage")).toBeLessThan(
      order.findIndex((path) =>
        path.startsWith("/storage/v1/object/attachments/"),
      ),
    );
    // #121: storage is free — the upload path never resolves a plan budget
    // (no companies read at all on POST).
    expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(0);
    // Upload keyed {company}/{owner_type}/{owner_id}/{uuid}-{safe_name}.
    const upload = sb.find("POST", /^\/storage\/v1\/object\/attachments\//)[0];
    expect(upload.path).toMatch(
      new RegExp(
        `/storage/v1/object/attachments/${COMPANY_ID}/note/${NOTE_ID}/[0-9a-f-]+-photo\\.png$`,
      ),
    );
    // The atomic claim carried the owner + the storage path + the #121
    // UNBOUNDED budget (storage never blocks); there is NO separate PostgREST
    // insert (the RPC inserts under the lock).
    const claim = sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")[0];
    const p = claim.body as Record<string, unknown>;
    expect(p).toMatchObject({
      p_company_id: COMPANY_ID,
      p_owner_type: "note",
      p_owner_id: NOTE_ID,
      p_conversation_id: CONV_ID,
      p_content_type: "image/png",
      p_uploaded_by: auth.subject,
      p_budget_bytes: Number.MAX_SAFE_INTEGER,
    });
    expect(p.p_storage_path).toMatch(
      new RegExp(`^${COMPANY_ID}/note/${NOTE_ID}/[0-9a-f-]+-photo\\.png$`),
    );
    expect(sb.find("POST", "/rest/v1/attachments")).toHaveLength(0);
    // A note_attachment_added audit event on the owner's conversation (D22),
    // referencing the claimed row id.
    const event = (
      sb.find("POST", "/rest/v1/conversation_events")[0].body as Record<
        string,
        unknown
      >[]
    )[0];
    expect(event).toMatchObject({
      type: "note_attachment_added",
      conversation_id: CONV_ID,
      actor_user_id: auth.subject,
      payload: { attachment_id: ATTACHMENT_ID },
    });
  });

  it("422s owner_type=task with plain copy — the task ingress is removed (D28)", async () => {
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
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toContain("attach them to a note");
    // Rejected before any owner lookup, storage, or insert work.
    expect(sb.find("GET", "/rest/v1/tasks")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/messages")).toHaveLength(0);
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/attachments")).toHaveLength(0);
  });

  it("422s an unknown owner_type", async () => {
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
        rawBody: uploadForm("bogus", NOTE_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(422);
  });

  it("404s an owner outside the caller's company (RLS scoping) before uploading", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/messages", () => []); // not found in this company
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/attachments",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("note", NOTE_ID, {
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

  it("404s a messages row that is not a note (direction inbound)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "inbound" },
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
        rawBody: uploadForm("note", NOTE_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(404);
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
        rawBody: uploadForm("note", NOTE_ID, {
          name: "run.exe",
          type: "application/x-msdownload",
          bytes: new Uint8Array([0x4d, 0x5a]),
        }),
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("GET", "/rest/v1/messages")).toHaveLength(0);
  });

  it("422s when the bytes contradict the declared type (declared png, bytes pdf)", async () => {
    const sb = stubWithRole("member");
    uploadStubs(sb);
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
        rawBody: uploadForm("note", NOTE_ID, {
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
    uploadStubs(sb);
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
        rawBody: uploadForm("note", NOTE_ID, {
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
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "note" },
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
        rawBody: uploadForm("note", NOTE_ID, {
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
    // The per-owner cap fires BEFORE the budget claim — the RPC is never called.
    expect(
      sb.find("POST", "/rest/v1/rpc/claim_attachment_storage"),
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // #121 (supersedes D30's 5/25 GB budgets): storage is FREE. The atomic
  // claim_attachment_storage RPC keeps its row-insert + accounting role, but
  // the Worker passes Number.MAX_SAFE_INTEGER as the budget, so an upload can
  // NEVER 409 on storage — not at the old boundary, not terabytes past it.
  // #15's claim-first ordering (and the release on a failed upload) stays.
  // -------------------------------------------------------------------------
  /** The RETIRED D30 starter figure — kept to prove the old wall is gone. */
  const OLD_STARTER_BUDGET = 5 * 1024 * 1024 * 1024;

  async function uploadPng(sb: SupabaseStub): Promise<Response> {
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(app, env, await auth.token(), "/v1/attachments", {
      method: "POST",
      companyId: COMPANY_ID,
      rawBody: uploadForm("note", NOTE_ID, {
        name: "photo.png",
        type: "image/png",
        bytes: pngBytes(), // 64 bytes
      }),
    });
  }

  /** Storage upload + audit event responders (the claim RPC is in uploadStubs). */
  function acceptUpload(sb: SupabaseStub) {
    sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({ Key: "x" }));
    sb.on("POST", "/rest/v1/conversation_events", () => []);
  }

  it("uploads with existing stored bytes (the accounting claim still runs)", async () => {
    const sb = stubWithRole("member");
    uploadStubs(sb, { storedBytes: 1024 });
    acceptUpload(sb);
    const res = await uploadPng(sb);
    expect(res.status).toBe(201);
  });

  it("never 409s on storage: one byte past the OLD 5 GB budget succeeds end-to-end (#121)", async () => {
    const sb = stubWithRole("member");
    // stored = old budget - 63; + the 64-byte file = old budget + 1 — the
    // exact setup that used to produce the D30 409. With the unbounded
    // budget the claim allows it and the whole pipeline runs.
    uploadStubs(sb, { storedBytes: OLD_STARTER_BUDGET - 63 });
    acceptUpload(sb);
    const res = await uploadPng(sb);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: ATTACHMENT_ID, owner_type: "note" });
    // Claim → upload → audit event, all landed.
    const claim = sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")[0];
    expect((claim.body as Record<string, unknown>).p_budget_bytes).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(
      sb.find("POST", /^\/storage\/v1\/object\/attachments\//),
    ).toHaveLength(1);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(1);
  });

  it("terabytes already stored: still 201 (#121 — abuse is an alert, never a block)", async () => {
    const sb = stubWithRole("member");
    uploadStubs(sb, { storedBytes: 10 * 1024 ** 4 }); // 10 TB live
    acceptUpload(sb);
    const res = await uploadPng(sb);
    expect(res.status).toBe(201);
  });

  it("releases the claimed row when the Storage upload fails (#15 — no budget held for absent bytes)", async () => {
    const sb = stubWithRole("member");
    uploadStubs(sb, { storedBytes: 1024 });
    // The upload blows up AFTER the claim landed.
    sb.on(
      "POST",
      /^\/storage\/v1\/object\/attachments\//,
      () =>
        new Response(JSON.stringify({ error: "boom", message: "boom" }), {
          status: 500,
        }),
    );
    sb.on("DELETE", "/rest/v1/attachments", () => []);
    const res = await uploadPng(sb);
    expect(res.status).toBe(500);

    // The claimed row was released (scoped hard-delete by company + id)…
    const release = sb.find("DELETE", "/rest/v1/attachments")[0];
    expect(release.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(release.url.searchParams.get("id")).toBe(`eq.${ATTACHMENT_ID}`);
    // …and no audit event was written for the failed upload.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("back-to-back uploads across the old boundary BOTH succeed — the budget wall is gone (#121)", async () => {
    // The old D30 TOCTOU scenario: two uploads racing the last 64 budget
    // bytes — the second used to be rejected under the advisory lock. #121:
    // the RPC still serializes and ACCOUNTS both (liveBytes grows), but with
    // the unbounded budget neither can be refused.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "note" },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({ Key: "x" }));
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    // The RPC stub keeps the SQL's re-sum math so the outcome is derived from
    // the unbounded budget, not hardcoded.
    let liveBytes = OLD_STARTER_BUDGET - 64;
    const budgets: number[] = [];
    sb.on("POST", "/rest/v1/rpc/claim_attachment_storage", (call) => {
      const p = call.body as { p_size_bytes: number; p_budget_bytes: number };
      budgets.push(p.p_budget_bytes);
      if (liveBytes + p.p_size_bytes > p.p_budget_bytes) return { allowed: false };
      liveBytes += p.p_size_bytes;
      return {
        allowed: true,
        attachment: {
          id: ATTACHMENT_ID,
          owner_type: "note",
          owner_id: NOTE_ID,
          conversation_id: CONV_ID,
          storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-photo.png`,
          file_name: "photo.png",
          content_type: "image/png",
          size_bytes: p.p_size_bytes,
          created_at: "2026-07-02T10:00:00+00:00",
        },
      };
    });
    stubFetch(jwksRoute(auth), sb.route);

    const first = await uploadPng(sb); // fills the last 64 old-budget bytes
    expect(first.status).toBe(201);
    const second = await uploadPng(sb); // past the old wall — still fine
    expect(second.status).toBe(201);
    // Both claims ran (accounting intact), both carried the unbounded budget,
    // and the live sum kept growing past the old ceiling.
    expect(budgets).toEqual([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    expect(liveBytes).toBe(OLD_STARTER_BUDGET + 64);
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
  it("soft-deletes a live task attachment, audits task_attachment_removed WITH task_id, returns 204", async () => {
    const sb = stubWithRole("member");
    // The route now SELECTs the live row FIRST (to gate the delete on #106
    // number access before mutating), then PATCHes deleted_at. owner_id rides
    // the lookup so a legacy task removal can carry task_id (= the owning task
    // id) in the event payload — the key loadTaskActivity filters on.
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "task",
        owner_id: TASK_ID,
        conversation_id: CONV_ID,
        file_name: "quote.pdf",
      },
    ]);
    sb.on("PATCH", "/rest/v1/attachments", () => [{ id: ATTACHMENT_ID }]);
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

    // The pre-mutation lookup is company-scoped, live-only, and projects
    // owner_id/conversation_id (needed for the task_id payload + the #106 gate).
    const lookup = sb.find("GET", "/rest/v1/attachments")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("id")).toBe(`eq.${ATTACHMENT_ID}`);
    expect(lookup.url.searchParams.get("deleted_at")).toBe("is.null");
    expect(lookup.url.searchParams.get("select")).toContain("owner_id");

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
      payload: {
        attachment_id: ATTACHMENT_ID,
        file_name: "quote.pdf",
        task_id: TASK_ID,
      },
    });
  });

  it("audits note_attachment_removed for a note-owned attachment", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        owner_id: NOTE_ID,
        conversation_id: CONV_ID,
        file_name: "spec.pdf",
      },
    ]);
    sb.on("PATCH", "/rest/v1/attachments", () => [{ id: ATTACHMENT_ID }]);
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
    // A note removal carries NO task_id (owner_id is a message id, not a task).
    expect(event.payload).not.toHaveProperty("task_id");
  });

  it("404s an id outside the company / already deleted (no event written)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => []); // lookup matched no live row
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    // Never mutates when the pre-check misses.
    expect(sb.find("PATCH", "/rest/v1/attachments")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("#106: 404s (no mutation) when the caller can't access the number", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    // One admins-only rule the member can't match → the number is hidden.
    sb.on("GET", "/rest/v1/number_access", () => [
      {
        phone_number_id: "99999999-8888-4777-8666-555555555555",
        principal_kind: "role",
        principal: "admin",
        level: "text",
      },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        owner_id: NOTE_ID,
        conversation_id: CONV_ID,
        file_name: "spec.pdf",
      },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { phone_number_id: "99999999-8888-4777-8666-555555555555" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    // The gate ran BEFORE any write — nothing soft-deleted, nothing audited.
    expect(sb.find("PATCH", "/rest/v1/attachments")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });
});

describe("#106 number access — attachments never leak a hidden number", () => {
  const HIDDEN_NUMBER = "99999999-8888-4777-8666-555555555555";

  /**
   * A member whose access to CONV_ID's number resolves to 'none': one
   * admins-only rule the member (role 'member') can't match, plus the
   * conversation → phone_number_id lookup requireConversationAccess runs.
   * Built directly (not via stubWithRole) so the hiding rule is the FIRST
   * number_access responder — responders resolve in registration order.
   */
  function memberHiddenStub(): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/number_access", () => [
      {
        phone_number_id: HIDDEN_NUMBER,
        principal_kind: "role",
        principal: "admin",
        level: "text",
      },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { phone_number_id: HIDDEN_NUMBER },
    ]);
    return sb;
  }

  it("GET /:id/url — generic arm 404s a hidden number's attachment; nothing is signed", async () => {
    const sb = memberHiddenStub();
    sb.on("GET", "/rest/v1/attachments", () => [
      { storage_path: "p", size_bytes: 2048, conversation_id: CONV_ID },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    // No egress claim and no Storage sign for a hidden number.
    expect(sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")).toHaveLength(0);
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("GET /:id/url — MMS arm 404s a hidden number's media (resolves message → conversation)", async () => {
    const sb = memberHiddenStub();
    sb.on("GET", "/rest/v1/attachments", () => []); // fall through to MMS
    sb.on("GET", "/rest/v1/message_attachments", () => [
      { storage_path: `mms-media/${COMPANY_ID}/msg-1/0`, size_bytes: 100, message_id: NOTE_ID },
    ]);
    sb.on("GET", "/rest/v1/messages", () => [{ conversation_id: CONV_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("GET /attachments — 404s the list when the owner's number is hidden", async () => {
    const sb = memberHiddenStub();
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        owner_id: NOTE_ID,
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
      `/v1/attachments?owner_type=note&owner_id=${NOTE_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });

  it("POST /attachments — 404s an upload to a hidden number's note; no budget claim", async () => {
    const sb = memberHiddenStub();
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONV_ID, direction: "note" },
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
        rawBody: uploadForm("note", NOTE_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      },
    );
    expect(res.status).toBe(404);
    // Blocked before the byte-cap count and the D30 budget claim.
    expect(sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")).toHaveLength(0);
  });

  it("owner sees everything — the guards short-circuit with no number_access read", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: ATTACHMENT_ID,
        owner_type: "note",
        owner_id: NOTE_ID,
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
      `/v1/attachments?owner_type=note&owner_id=${NOTE_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    // Owner is unrestricted: the access guard never queries number_access.
    expect(sb.find("GET", "/rest/v1/number_access")).toHaveLength(0);
  });
});
