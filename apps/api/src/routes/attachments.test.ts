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
import { isZeroed, jpegWithGps } from "../test/exif-fixtures";
import {
  completeEnv,
  createTestAuth,
  type FetchRoute,
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
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  // #121: NO company_modules stub — the storage budgets (and their module
  // resolution) are retired; a read would fail loudly as unstubbed.
  // #106: the access guards resolve number_access for members; [] = no rules →
  // unrestricted, so the guard short-circuits and these assertions are
  // unchanged. Tests that exercise a hidden number stub this route explicitly.
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
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
    sb.on("POST", "/rest/v1/rpc/claim_signed_url_egress_objects", (call) => {
      const p = call.body as {
        p_objects: { bytes: number }[];
        p_limit_bytes: number;
      };
      const claimed = p.p_objects.reduce((sum, o) => sum + o.bytes, 0);
      const used = options.usedBytes ?? 0;
      if (used + claimed > p.p_limit_bytes) {
        return { allowed: false, used_bytes: used, claimed_bytes: 0 };
      }
      return {
        allowed: true,
        used_bytes: used + claimed,
        claimed_bytes: claimed,
      };
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
    const claim = sb.find(
      "POST",
      "/rest/v1/rpc/claim_signed_url_egress_objects",
    )[0];
    expect(claim.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_since: PERIOD_START,
      p_limit_bytes: EGRESS_ALLOWANCE,
      // #261: keyed on the object, so asking again while the URL is still
      // valid costs nothing.
      p_objects: [
        {
          key: `attachments/${COMPANY_ID}/task/${TASK_ID}/uuid-quote.pdf`,
          bucket: "attachments",
          bytes: 2048,
        },
      ],
    });
    const order = sb.calls.map((call) => call.path);
    expect(
      order.indexOf("/rest/v1/rpc/claim_signed_url_egress_objects"),
    ).toBeLessThan(
      order.findIndex((path) => path.startsWith("/storage/v1/object/sign/")),
    );
  });

  /**
   * #240 — a thread renders a picture of the file, not the file.
   *
   * A note attachment is 25 MB and ten per note (D19 §2.4). Serving those to
   * every member on every scroll is the single worst egress shape in the
   * product, and it is the tech's own mobile data too (#289).
   */
  describe("which of a row's two objects gets signed", () => {
    const ORIGINAL = `${COMPANY_ID}/note/${TASK_ID}/uuid-roof.jpg`;
    const PREVIEW = `${COMPANY_ID}/note/${TASK_ID}/preview-uuid-roof.jpg`;

    function rowWithPreview(sb: SupabaseStub) {
      sb.on("GET", "/rest/v1/attachments", () => [
        {
          storage_path: ORIGINAL,
          size_bytes: 20971520,
          preview_path: PREVIEW,
          preview_bytes: 184320,
          content_type: "image/jpeg",
        },
      ]);
      egressStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
        signedURL: "/object/sign/attachments/x?token=sig",
      }));
    }

    async function mint(sb: SupabaseStub, query = "") {
      stubFetch(jwksRoute(auth), sb.route);
      return apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/attachments/${ATTACHMENT_ID}/url${query}`,
        { companyId: COMPANY_ID },
      );
    }

    it("serves the preview by DEFAULT", async () => {
      // The default is the whole feature. Defaulting the other way would have
      // been the safer-looking choice and would have shipped it inert: every
      // existing client asks this route with no query at all.
      const sb = stubWithRole("member");
      rowWithPreview(sb);
      const res = await mint(sb);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ variant: "preview" });
      expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0].path).toBe(
        `/storage/v1/object/sign/attachments/${PREVIEW}`,
      );
    });

    it("charges egress for the bytes it actually serves", async () => {
      // Claiming the original's 20 MB for a 180 KB preview would spend a
      // workspace's allowance on bytes that never left — the exact opposite of
      // what serving derivatives is for, and invisible unless asserted.
      const sb = stubWithRole("member");
      rowWithPreview(sb);
      await mint(sb);
      const claim = sb.find(
        "POST",
        "/rest/v1/rpc/claim_signed_url_egress_objects",
      )[0];
      expect(claim.body).toMatchObject({
        p_objects: [{ key: `attachments/${PREVIEW}`, bytes: 184320 }],
      });
    });

    it("serves the original when the caller explicitly asks", async () => {
      // A full-size view and a download both want the file itself. Making that
      // a deliberate act is what keeps the cheap path the common one.
      const sb = stubWithRole("member");
      rowWithPreview(sb);
      const res = await mint(sb, "?variant=original");
      expect(await res.json()).toMatchObject({ variant: "original" });
      expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0].path).toBe(
        `/storage/v1/object/sign/attachments/${ORIGINAL}`,
      );
      const claim = sb.find(
        "POST",
        "/rest/v1/rpc/claim_signed_url_egress_objects",
      )[0];
      expect(claim.body).toMatchObject({
        p_objects: [{ key: `attachments/${ORIGINAL}`, bytes: 20971520 }],
      });
    });

    it("serves the original for a row that has no preview", async () => {
      // Every attachment uploaded before this shipped, and anything sent by a
      // client that does not make one. PostgREST omits a column it has nothing
      // to say about, so the row arrives with the field UNDEFINED — and
      // `undefined !== null` is true, which would sign the string "undefined"
      // as an object key.
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/attachments", () => [
        { storage_path: ORIGINAL, size_bytes: 20971520, content_type: "image/jpeg" },
      ]);
      egressStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
        signedURL: "/object/sign/attachments/x?token=sig",
      }));
      const res = await mint(sb);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ variant: "original" });
      expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0].path).toBe(
        `/storage/v1/object/sign/attachments/${ORIGINAL}`,
      );
    });

    it("still refuses a quarantined row, whichever variant is asked for", async () => {
      // #317: a reported file stops downloading for EVERYONE, and a preview is
      // a second door onto the same report.
      for (const query of ["", "?variant=original"]) {
        const sb = stubWithRole("member");
        sb.on("GET", "/rest/v1/attachments", () => [
          {
            storage_path: ORIGINAL,
            size_bytes: 20971520,
            preview_path: PREVIEW,
            preview_bytes: 184320,
            content_type: "image/jpeg",
            quarantined_at: "2026-08-01T00:00:00Z",
          },
        ]);
        egressStubs(sb);
        const res = await mint(sb, query);
        expect(res.status, query).toBe(403);
        expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//), query).toHaveLength(0);
      }
    });

    it("says `original` for MMS media, which has no derivative", async () => {
      // Every inbound item is ≤1 MB by carrier limit (D28) — the founder's own
      // re-derivation on #240. The original IS the bounded preview here, and
      // saying so keeps a client from asking for a variant that cannot exist.
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/attachments", () => []);
      sb.on("GET", "/rest/v1/message_attachments", () => [
        {
          storage_path: "mms-media/co/msg/img.jpg",
          size_bytes: 900000,
          message_id: NOTE_ID,
          content_type: "image/jpeg",
        },
      ]);
      egressStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
        signedURL: "/object/sign/mms-media/x?token=sig",
      }));
      const res = await mint(sb);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ variant: "original" });
    });
  });

  /**
   * #317 — what a signed URL lets the browser DO with the bytes.
   *
   * This product is a conduit between a business and members of the public who are
   * strangers to it: anyone who knows the number can send a file, because the
   * number is printed on a truck. We store it, sign it, and hand it to a tech's
   * phone and the office manager's laptop — so if it is malicious we are the
   * delivery mechanism, and the customer's antivirus names us.
   *
   * The allow-list plus the magic-byte check already refuse the wrong file TYPE.
   * They cannot refuse a malicious file of an ALLOWED type, and the list has to
   * include the formats that carry payloads: PDF, and the OpenXML/ODF family,
   * which are ZIP containers.
   */
  describe("#317 content disposition follows the type", () => {
    /**
     * The minted URL.
     *
     * supabase-js appends `download` as a query parameter to the signed URL
     * rather than sending it in the sign request, and Storage turns that
     * parameter into `Content-Disposition: attachment` on the response. So the
     * URL is both the observable effect and exactly what the browser acts on —
     * asserting on the sign request body would assert on nothing.
     */
    async function mintedUrl(sb: SupabaseStub): Promise<string> {
      const res = await mint(sb);
      expect(res.status).toBe(200);
      return ((await res.json()) as { url: string }).url;
    }

    async function mint(sb: SupabaseStub): Promise<Response> {
      egressStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
        signedURL: `/object/sign/attachments/x?token=sig`,
      }));
      stubFetch(jwksRoute(auth), sb.route);
      return apiRequest(app, env, await auth.token(), `/v1/attachments/${ATTACHMENT_ID}/url`, {
        companyId: COMPANY_ID,
      });
    }

    it("forces a download for a PDF", async () => {
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/attachments", () => [
        { storage_path: `${COMPANY_ID}/note/x/quote.pdf`, size_bytes: 2048,
          content_type: "application/pdf" },
      ]);
      expect(await mintedUrl(sb)).toMatch(/[?&]download(=|$)/);
    });

    it("forces a download for the ZIP-container document formats", async () => {
      // These are the ones the issue is really about — a .docx is a ZIP.
      for (const type of [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.spreadsheet",
      ]) {
        const sb = stubWithRole("member");
        sb.on("GET", "/rest/v1/attachments", () => [
          { storage_path: `${COMPANY_ID}/note/x/doc`, size_bytes: 10, content_type: type },
        ]);
        expect(await mintedUrl(sb), type).toMatch(/[?&]download(=|$)/);
      }
    });

    it("leaves an image INLINE, because the thread renders it", async () => {
      // Forcing a download here would replace the product's most common
      // interaction — looking at a photo of a broken furnace — with a save
      // dialog. Images are also the lower-risk half: SVG, the format that
      // actually executes in a document context, is not in the allow-list.
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/attachments", () => [
        { storage_path: `${COMPANY_ID}/note/x/photo.jpg`, size_bytes: 2048,
          content_type: "image/jpeg" },
      ]);
      expect(await mintedUrl(sb)).not.toMatch(/[?&]download(=|$)/);
    });

    it("forces a download when the type is missing or unrecognised", async () => {
      // Fails toward the safe direction. A legacy row with no content_type gets a
      // download rather than whatever the browser decides to do with unknown
      // bytes — and an unguarded read of an absent column previously turned the
      // mint into a 500, which is how this assertion earned its place.
      for (const row of [
        { storage_path: `${COMPANY_ID}/note/x/legacy`, size_bytes: 1 },
        { storage_path: `${COMPANY_ID}/note/x/odd`, size_bytes: 1, content_type: null },
        { storage_path: `${COMPANY_ID}/note/x/svg`, size_bytes: 1,
          content_type: "image/svg+xml" },
      ]) {
        const sb = stubWithRole("member");
        sb.on("GET", "/rest/v1/attachments", () => [row]);
        expect(await mintedUrl(sb), JSON.stringify(row)).toMatch(
          /[?&]download(=|$)/,
        );
      }
    });
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
    // The key uses the STRIPPED path — the same spelling the gallery claims
    // on, so one photo is never charged twice for being asked two ways (#261).
    const claim = sb.find(
      "POST",
      "/rest/v1/rpc/claim_signed_url_egress_objects",
    )[0];
    expect(claim.body).toMatchObject({
      p_objects: [
        {
          key: `mms-media/${COMPANY_ID}/msg-1/0`,
          bucket: "mms-media",
          bytes: 0,
        },
      ],
    });
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
      "/rest/v1/rpc/claim_signed_url_egress_objects",
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
    const claim = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress_objects")[0];
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
    expect(sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress_objects")).toHaveLength(0);
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
    // #240: "nobody in this company has uploaded these exact bytes" — the
    // world every test written before dedup was against. A suite that wants a
    // twin registers this path itself and wins.
    sb.on("POST", "/rest/v1/rpc/api_attachment_by_content", () => null);
    // …and the hash stamp that follows a successful upload. Ambient because it
    // is best-effort: a failure logs and the row simply never dedups.
    sb.on("PATCH", "/rest/v1/attachments", () => []);
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

  /**
   * #240 — the uploader sends a bounded preview beside the original.
   *
   * It is the one place in the system where a resize costs nothing: that device
   * has already decoded the image, because it just showed it to somebody in a
   * picker. Everything else about it is a client-supplied file and is treated
   * as one.
   */
  describe("the preview that rides along", () => {
    function bigJpeg(sizeBytes: number): Uint8Array {
      const bytes = new Uint8Array(sizeBytes);
      bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
      return bytes;
    }

    function withPreview(
      form: FormData,
      preview: { bytes: Uint8Array; type: string },
    ): FormData {
      form.append(
        "preview",
        new File([preview.bytes.slice().buffer], "preview.jpg", {
          type: preview.type,
        }),
      );
      return form;
    }

    async function upload(sb: SupabaseStub, form: FormData) {
      stubFetch(jwksRoute(auth), sb.route);
      return apiRequest(app, env, await auth.token(), "/v1/attachments", {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: form,
      });
    }

    it("stores it beside the original and stamps the row", async () => {
      const sb = stubWithRole("member");
      uploadStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
        Key: "attachments/x",
      }));
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(
        sb,
        withPreview(
          uploadForm("note", NOTE_ID, {
            name: "roof.jpg",
            type: "image/jpeg",
            bytes: bigJpeg(4 * 1024 * 1024),
          }),
          { bytes: bigJpeg(120 * 1024), type: "image/jpeg" },
        ),
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ has_preview: true });

      // Two objects, the preview keyed beside its original so the pair is
      // legible in a bucket listing.
      const writes = sb.find("POST", /^\/storage\/v1\/object\/attachments\//);
      expect(writes).toHaveLength(2);
      // The key is derived from the ORIGINAL's, which carries a fresh uuid per
      // upload — so the assertion is on the marker segment, not on a literal.
      expect(writes[1].path).toMatch(/\/preview-[0-9a-f-]+-roof\.jpg$/);

      // …and the row points at it, with the size the egress claim will charge.
      const stamp = sb.find("PATCH", "/rest/v1/attachments")[0];
      expect(stamp.body).toMatchObject({ preview_bytes: 120 * 1024 });
    });

    it("#581/13: strips the location from the PREVIEW as well as the original", async () => {
      /**
       * D128's promise is that a customer's home coordinates never reach the bucket.
       * It was being kept for one of the two objects we store per photo.
       *
       * The original was stripped; the preview — a separate file the client also
       * chose — got the type check, the magic bytes, the size bounds and the malware
       * scan, and went to storage with its Exif intact. Nothing about a phone
       * resizing an image makes it drop the GPS block; several deliberately carry it
       * across.
       *
       * It matters most where it is least visible: #581/9 made the preview the object
       * the PUBLIC job-photos page serves, so the leak had a route to somebody
       * outside the business entirely.
       *
       * Asserted on the BYTES THAT REACHED STORAGE, through a route that reads the
       * raw body — the supabase stub records a request body as text, which is lossy
       * for a binary upload and cannot answer this question.
       */
      const original = jpegWithGps();
      const preview = jpegWithGps();
      // Big enough that a ~110-byte preview counts as materially smaller. Padded
      // after the EOI marker, so the Exif block the strip parses is untouched and
      // `latAt` still points where it did.
      const padded = new Uint8Array(4 * 1024 * 1024);
      padded.set(original.bytes, 0);

      const sb = stubWithRole("member");
      uploadStubs(sb);
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const stored: { path: string; bytes: Uint8Array }[] = [];
      const capture: FetchRoute = async (url, request) => {
        if (!url.pathname.startsWith("/storage/v1/object/attachments/")) {
          return undefined;
        }
        stored.push({
          path: url.pathname,
          bytes: new Uint8Array(await request.clone().arrayBuffer()),
        });
        return Response.json({ Key: "attachments/x" });
      };

      stubFetch(jwksRoute(auth), capture, sb.route);
      const res = await apiRequest(app, env, await auth.token(), "/v1/attachments", {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: withPreview(
          uploadForm("note", NOTE_ID, {
            name: "kitchen.jpg",
            type: "image/jpeg",
            bytes: padded,
          }),
          { bytes: preview.bytes, type: "image/jpeg" },
        ),
      });

      expect(res.status).toBe(201);
      expect(stored).toHaveLength(2);

      const previewObject = stored.find((object) => object.path.includes("/preview-"));
      const originalObject = stored.find((object) => !object.path.includes("/preview-"));
      expect(previewObject, "no preview reached storage").toBeDefined();
      expect(originalObject, "no original reached storage").toBeDefined();

      // The latitude is GONE from both — not orphaned, not unreferenced. Zeroed.
      expect(
        isZeroed(previewObject!.bytes, preview.latAt, preview.latLength),
        "the preview still carries the coordinates of somebody's home",
      ).toBe(true);
      expect(
        isZeroed(originalObject!.bytes, original.latAt, original.latLength),
        "the original still carries the coordinates of somebody's home",
      ).toBe(true);
    });

    it("keeps the upload when only the preview fails", async () => {
      // The original is the file; the preview is a way of serving it cheaply.
      // A storage hiccup on the derivative must not cost somebody the upload
      // they actually made — the row simply serves its original, which is what
      // every row did before this shipped.
      const sb = stubWithRole("member");
      uploadStubs(sb);
      let write = 0;
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => {
        write += 1;
        return write === 1
          ? ({ Key: "attachments/x" } as unknown as Record<string, unknown>)
          : new Response(JSON.stringify({ message: "storage is having a day" }), {
              status: 500,
            });
      });
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(
        sb,
        withPreview(
          uploadForm("note", NOTE_ID, {
            name: "roof.jpg",
            type: "image/jpeg",
            bytes: bigJpeg(4 * 1024 * 1024),
          }),
          { bytes: bigJpeg(120 * 1024), type: "image/jpeg" },
        ),
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ has_preview: false });
      // Nothing was stamped, so nothing points at a half-written object.
      expect(sb.find("PATCH", "/rest/v1/attachments")).toHaveLength(0);
    });

    it("refuses a bad preview BEFORE either object is written", async () => {
      // A 422 and no storage, rather than an orphaned original nobody asked
      // for. The preview here is bigger than the ceiling — the shape of "a
      // client that is not really resizing".
      const sb = stubWithRole("member");
      uploadStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
        Key: "attachments/x",
      }));

      const res = await upload(
        sb,
        withPreview(
          uploadForm("note", NOTE_ID, {
            name: "roof.jpg",
            type: "image/jpeg",
            bytes: bigJpeg(4 * 1024 * 1024),
          }),
          { bytes: bigJpeg(900 * 1024), type: "image/jpeg" },
        ),
      );
      expect(res.status).toBe(422);
      expect(sb.find("POST", /^\/storage\/v1\/object\/attachments\//)).toHaveLength(0);
      expect(sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")).toHaveLength(0);
    });

    it("uploads exactly as before when no preview is sent", async () => {
      // Every client that has not shipped this yet, and every file that never
      // gets one — a PDF, a spreadsheet, a small photo.
      const sb = stubWithRole("member");
      uploadStubs(sb);
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
        Key: "attachments/x",
      }));
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(
        sb,
        uploadForm("note", NOTE_ID, {
          name: "photo.png",
          type: "image/png",
          bytes: pngBytes(),
        }),
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ has_preview: false });
      expect(sb.find("POST", /^\/storage\/v1\/object\/attachments\//)).toHaveLength(1);
      // One stamp, and it carries the hash ONLY — there is no preview to point
      // at, and writing a null over one would be a different bug.
      const stamp = sb.find("PATCH", "/rest/v1/attachments");
      expect(stamp).toHaveLength(1);
      expect(Object.keys(stamp[0].body as object)).toEqual(["content_sha256"]);
    });
  });

  /**
   * #240 item 3 — "a 25 MB file forwarded into three threads is 75 MB".
   *
   * The row is always real and separate: its own id, owner, name and audit
   * trail. What it shares is the bytes.
   */
  describe("the same file, stored once", () => {
    const TWIN_PATH = `${COMPANY_ID}/note/${NOTE_ID}/uuid-original.pdf`;

    function twinStubs(sb: SupabaseStub, twin: Record<string, unknown> | null) {
      sb.on("POST", "/rest/v1/rpc/api_attachment_by_content", () => twin);
    }

    async function upload(sb: SupabaseStub) {
      stubFetch(jwksRoute(auth), sb.route);
      return apiRequest(app, env, await auth.token(), "/v1/attachments", {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: uploadForm("note", NOTE_ID, {
          name: "spec.pdf",
          type: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 the same spec sheet"),
        }),
      });
    }

    it("skips the upload and points the new row at the existing object", async () => {
      const sb = stubWithRole("member");
      // Registered BEFORE uploadStubs: handlers are first-match-wins, and
      // uploadStubs carries the ambient "no twin" answer.
      twinStubs(sb, {
        storage_path: TWIN_PATH,
        preview_path: null,
        preview_bytes: null,
      });
      uploadStubs(sb);
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(sb);
      expect(res.status).toBe(201);
      // Nothing was written to Storage — the bytes are already there.
      expect(sb.find("POST", /^\/storage\/v1\/object\/attachments\//)).toHaveLength(0);
      // …but a row was still claimed: it is a separate attachment on a separate
      // note, with its own audit event, that happens to share an object.
      expect(sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")).toHaveLength(1);
      expect(
        sb.find("POST", "/rest/v1/rpc/claim_attachment_storage")[0].body,
      ).toMatchObject({ p_storage_path: TWIN_PATH });
      expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(1);
    });

    it("inherits the twin's preview rather than storing a second one", async () => {
      // Reusing the original and uploading a fresh preview beside it would
      // store one file twice as far as the thread is concerned — the same bug
      // wearing a different hat.
      const sb = stubWithRole("member");
      twinStubs(sb, {
        storage_path: TWIN_PATH,
        preview_path: `${COMPANY_ID}/note/${NOTE_ID}/preview-uuid-original.pdf`,
        preview_bytes: 150000,
      });
      uploadStubs(sb);
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(sb);
      expect(await res.json()).toMatchObject({ has_preview: true });
      expect(sb.find("PATCH", "/rest/v1/attachments")[0].body).toMatchObject({
        preview_path: `${COMPANY_ID}/note/${NOTE_ID}/preview-uuid-original.pdf`,
        preview_bytes: 150000,
      });
    });

    it("hashes the bytes and asks scoped to the caller's company", async () => {
      // Cross-tenant sharing would save more and would have one workspace's row
      // serving bytes another uploaded. The company id is an argument here AND
      // a predicate in the SQL, deliberately.
      const sb = stubWithRole("member");
      uploadStubs(sb);
      twinStubs(sb, null);
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
        Key: "attachments/x",
      }));
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      await upload(sb);
      const lookup = sb.find("POST", "/rest/v1/rpc/api_attachment_by_content")[0];
      expect(lookup.body).toMatchObject({ p_company_id: COMPANY_ID });
      // SHA-256 of "%PDF-1.4 the same spec sheet", hex — pinned so a change of
      // algorithm or encoding cannot pass silently and split every workspace's
      // dedup index in half.
      expect((lookup.body as { p_sha256: string }).p_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("uploads normally, and records the hash, when nothing matches", async () => {
      // The hash has to land even with no preview to store, or this file can
      // never be the twin of the next upload.
      const sb = stubWithRole("member");
      uploadStubs(sb);
      twinStubs(sb, null);
      sb.on("POST", /^\/storage\/v1\/object\/attachments\//, () => ({
        Key: "attachments/x",
      }));
      sb.on("PATCH", "/rest/v1/attachments", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);

      const res = await upload(sb);
      expect(res.status).toBe(201);
      expect(sb.find("POST", /^\/storage\/v1\/object\/attachments\//)).toHaveLength(1);
      const stamp = sb.find("PATCH", "/rest/v1/attachments")[0];
      expect((stamp.body as { content_sha256: string }).content_sha256).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });

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
    // #240: this suite builds its own stubs rather than calling uploadStubs,
    // so it needs the two dedup paths explicitly — no twin, and a hash stamp
    // that lands.
    sb.on("POST", "/rest/v1/rpc/api_attachment_by_content", () => null);
    sb.on("PATCH", "/rest/v1/attachments", () => []);
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
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    // One admins-only rule the member can't match → the number is hidden.
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: "99999999-8888-4777-8666-555555555555", level: "none" },
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
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN_NUMBER, level: "none" },
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
    expect(sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress_objects")).toHaveLength(0);
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
    expect(sb.find("POST", "/rest/v1/rpc/member_number_levels")).toHaveLength(0);
  });
});

/**
 * #317 — the reporting path.
 *
 * The scan (D101) stops what it can recognise and is explicitly not antivirus.
 * When something gets past it the person who notices is a tech holding a phone,
 * and the only useful thing they can do has to reach the whole workspace: by
 * then the file is in the office manager's inbox too.
 */
describe("POST /v1/attachments/:id/report — a member pulls a file back for everyone", () => {
  it("quarantines an uploaded file and records who did it", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { conversation_id: CONV_ID, quarantined_at: null },
    ]);
    sb.on("PATCH", "/rest/v1/attachments", () => [{ id: ATTACHMENT_ID }]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/report`,
      { companyId: COMPANY_ID, method: "POST", body: { note: "looks wrong" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quarantined: true });

    const patch = sb.find("PATCH", "/rest/v1/attachments")[0];
    // Company-scoped, and guarded on still-unquarantined so two techs racing
    // produce one stamp rather than overwriting each other's.
    expect(patch.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(patch.url.searchParams.get("quarantined_at")).toBe("is.null");
    expect(patch.body).toMatchObject({
      // The reporter is recorded, because "who stopped this" is the first
      // question afterwards whichever way the call turns out to have been.
      quarantined_by_user_id: auth.subject,
      quarantine_note: "looks wrong",
    });

    // One member's judgement overriding everybody else's access is exactly the
    // kind of thing "who did this, and when" gets asked about afterwards.
    const audit = sb.find("POST", "/rest/v1/audit_log")[0];
    expect((audit.body as { action: string }).action).toBe("attachment.quarantined");
  });

  it("reports a customer's texted-in file too, not just uploads", async () => {
    // The inbound half is the one #317 calls uncontrolled — anyone who knows a
    // number printed on a truck can send a file. A reporter has an id and no
    // idea which table it came from, and should not have to.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/message_attachments", () => [
      { message_id: NOTE_ID, quarantined_at: null },
    ]);
    sb.on("PATCH", "/rest/v1/message_attachments", () => [{ id: ATTACHMENT_ID }]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/report`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/message_attachments")).toHaveLength(1);
  });

  it("is idempotent — the second person to flag it is doing the right thing", async () => {
    // Two techs flagging the same file within a minute of each other is the
    // NORMAL case. An error there teaches people not to bother.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      { conversation_id: CONV_ID, quarantined_at: "2026-07-31T00:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/report`,
      { companyId: COMPANY_ID, method: "POST", body: {} },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quarantined: true });
    // Nothing written a second time.
    expect(sb.find("PATCH", "/rest/v1/attachments")).toHaveLength(0);
  });

  it("stops the download for EVERYONE, with a reason rather than a 404", async () => {
    // A 404 would read as "we lost your photo" and send somebody looking for a
    // bug. The file plainly exists; it is on hold.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        storage_path: `${COMPANY_ID}/note/${NOTE_ID}/uuid-invoice.pdf`,
        size_bytes: 2048,
        conversation_id: CONV_ID,
        content_type: "application/pdf",
        quarantined_at: "2026-07-31T00:00:00+00:00",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    const held = (await res.json()) as { error: { message: string } };
    expect(held.error.message).toContain("on hold");
    // Refused BEFORE signing: no URL was ever minted for a held file.
    expect(sb.find("POST", /^\/storage\/v1\/object\/sign\//)).toHaveLength(0);
  });

  it("refuses a note longer than the timeline can carry", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/report`,
      { companyId: COMPANY_ID, method: "POST", body: { note: "x".repeat(281) } },
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /v1/attachments/:id/release — standing it down is a different call", () => {
  it("lets an admin release, and records it", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/attachments", () => [
      { conversation_id: CONV_ID, quarantined_at: "2026-07-31T00:00:00+00:00" },
    ]);
    sb.on("PATCH", "/rest/v1/attachments", () => [{ id: ATTACHMENT_ID }]);
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/release`,
      { companyId: COMPANY_ID, method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quarantined: false });
    expect(sb.find("PATCH", "/rest/v1/attachments")[0].body).toMatchObject({
      quarantined_at: null,
    });
    expect(
      (sb.find("POST", "/rest/v1/audit_log")[0].body as { action: string }).action,
    ).toBe("attachment.released");
  });

  it("does NOT let an ordinary member release what they or a teammate flagged", async () => {
    // The asymmetry is the point: raising the alarm belongs to whoever is
    // holding the phone, standing it down belongs to whoever answers for it.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/release`,
      { companyId: COMPANY_ID, method: "POST" },
    );
    expect(res.status).toBe(403);
  });
});
