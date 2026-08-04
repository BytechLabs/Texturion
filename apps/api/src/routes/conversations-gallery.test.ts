/**
 * GET /v1/conversations/:id/attachments — the attachments gallery (D21 /
 * APP-FEATURES-V2 §4.2 / TASKS.md T7.2): a two-arm union of the MMS
 * message_attachments (JOINed through messages for the conversation scope) and
 * the generic D19 attachments table (note + task, conversation_id
 * denormalized), tagged with a `source`, merged/sorted (created_at, id) DESC in
 * the API layer, cursor-paginated, each item freshly signed. Only global fetch
 * (JWKS + PostgREST + Storage) is stubbed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { decodeCursor } from "../http/pagination";
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
import { conversationsRoutes } from "./conversations";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const PERIOD_START = "2026-07-01T00:00:00+00:00";
// #121: the FIXED 200 GB per-period pool — see EGRESS_ALLOWANCE_BYTES (#16).
const EGRESS_ALLOWANCE = 200 * 1024 * 1024 * 1024;

let auth: TestAuth;
const app = buildTestApp(conversationsRoutes);

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
  // #106: no access rules → the member caller is unrestricted.
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  // The conversation existence gate (findConversation).
  sb.on("GET", "/rest/v1/conversations", () => [{ id: CONV_ID }]);
  // #16 egress-claim stubs every non-empty page needs (mirrors the
  // egressStubs helper in routes/attachments.test.ts).
  sb.on("GET", "/rest/v1/companies", () => [
    { plan: "starter", current_period_start: PERIOD_START },
  ]);
  // #121: no company_modules stub — the allowance is fixed, so the retired
  // storage-budget resolution is never read (it would fail loudly).
  sb.on("POST", "/rest/v1/rpc/claim_signed_url_egress_objects", (call) => {
    const p = call.body as { p_objects: { bytes: number }[] };
    const claimed = p.p_objects.reduce((sum, o) => sum + o.bytes, 0);
    return { allowed: true, used_bytes: claimed, claimed_bytes: claimed };
  });
  return sb;
}

/** Every createSignedUrl POST returns a token derived from the object path. */
function stubSigning(sb: SupabaseStub): void {
  sb.on("POST", /^\/storage\/v1\/object\/sign\//, (call) => ({
    signedURL: `${call.path.replace("/storage/v1/object/sign", "")}?token=sig`,
  }));
}

describe("GET /v1/conversations/:id/attachments (gallery union)", () => {
  it("unions MMS (joined) + generic (note/task) arms, tags source, sorts DESC, signs each", async () => {
    const sb = memberStub();
    // MMS arm (message_attachments joined through messages).
    sb.on("GET", "/rest/v1/message_attachments", () => [
      {
        id: "10000000-0000-4000-8000-000000000001",
        storage_path: `mms-media/${COMPANY_ID}/msg-1/0`,
        content_type: "image/jpeg",
        size_bytes: 4096,
        created_at: "2026-07-02T09:00:00+00:00",
      },
    ]);
    // Generic arm (note + task).
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: "20000000-0000-4000-8000-000000000002",
        owner_type: "task",
        storage_path: `${COMPANY_ID}/task/t1/uuid-quote.pdf`,
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 8192,
        created_at: "2026-07-02T11:00:00+00:00", // newest → first
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        owner_type: "note",
        storage_path: `${COMPANY_ID}/note/n1/uuid-site.png`,
        file_name: "site.png",
        content_type: "image/png",
        size_bytes: 2048,
        created_at: "2026-07-02T10:00:00+00:00",
      },
    ]);
    stubSigning(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        source: string;
        kind: string;
        url: string;
        content_type: string;
      }[];
      next_cursor: string | null;
    };

    // Sorted (created_at, id) DESC: task(11:00) → note(10:00) → mms(09:00).
    expect(body.data.map((item) => item.source)).toEqual([
      "task",
      "note",
      "mms",
    ]);
    // kind: image/* → 'image', else 'file'.
    expect(body.data.map((item) => item.kind)).toEqual([
      "file",
      "image",
      "image",
    ]);
    // Every item carries a freshly-signed URL (never a storage_path).
    for (const item of body.data) {
      expect(item.url).toContain("token=sig");
      expect(item).not.toHaveProperty("storage_path");
    }

    // MMS arm was JOINed through messages for the conversation scope (SPEC §6:
    // message_attachments has no conversation_id column).
    const mmsCall = sb.find("GET", "/rest/v1/message_attachments")[0];
    expect(mmsCall.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(mmsCall.url.searchParams.get("messages.conversation_id")).toBe(
      `eq.${CONV_ID}`,
    );
    expect(mmsCall.url.searchParams.get("select")).toContain("messages!inner");
    // Generic arm uses the denormalized conversation_id (no join), live only.
    const genericCall = sb.find("GET", "/rest/v1/attachments")[0];
    expect(genericCall.url.searchParams.get("conversation_id")).toBe(
      `eq.${CONV_ID}`,
    );
    expect(genericCall.url.searchParams.get("deleted_at")).toBe("is.null");

    // MMS bucket signs mms-media (prefix stripped); generic signs attachments.
    const signPaths = sb
      .find("POST", /^\/storage\/v1\/object\/sign\//)
      .map((call) => call.path);
    expect(signPaths).toContain(
      `/storage/v1/object/sign/mms-media/${COMPANY_ID}/msg-1/0`,
    );
    expect(signPaths).toContain(
      `/storage/v1/object/sign/attachments/${COMPANY_ID}/task/t1/uuid-quote.pdf`,
    );

    // #16/#261: the whole page's egress was claimed in ONE call, keyed per
    // object, and it landed BEFORE the first sign call. Per object is what
    // makes re-opening the gallery free — a per-bucket subtotal cannot tell a
    // new photo from the same one asked for again.
    const claims = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress_objects");
    expect(claims).toHaveLength(1);
    const claimBody = claims[0].body as {
      p_company_id: string;
      p_since: string;
      p_limit_bytes: number;
      p_objects: { key: string; bucket: string; bytes: number }[];
    };
    expect(claimBody.p_company_id).toBe(COMPANY_ID);
    expect(claimBody.p_since).toBe(PERIOD_START);
    expect(claimBody.p_limit_bytes).toBe(EGRESS_ALLOWANCE);
    expect(claimBody.p_objects).toEqual(
      expect.arrayContaining([
        {
          key: `mms-media/${COMPANY_ID}/msg-1/0`,
          bucket: "mms-media",
          bytes: 4096,
        },
      ]),
    );
    // The generic arm's two objects, claimed under their own keys.
    expect(
      claimBody.p_objects
        .filter((o) => o.bucket === "attachments")
        .reduce((sum, o) => sum + o.bytes, 0),
    ).toBe(10240);
    const order = sb.calls.map((call) => call.path);
    expect(order.indexOf("/rest/v1/rpc/claim_signed_url_egress_objects")).toBeLessThan(
      order.findIndex((path) => path.startsWith("/storage/v1/object/sign/")),
    );
  });

  it("402s usage_cap_reached over the egress allowance — nothing is signed (#16)", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/conversations", () => [{ id: CONV_ID }]);
    sb.on("GET", "/rest/v1/message_attachments", () => [
      {
        id: "10000000-0000-4000-8000-000000000001",
        storage_path: `mms-media/${COMPANY_ID}/msg-1/0`,
        content_type: "image/jpeg",
        size_bytes: 4096,
        created_at: "2026-07-02T09:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "starter", current_period_start: PERIOD_START },
    ]);
    sb.on("POST", "/rest/v1/rpc/claim_signed_url_egress_objects", () => ({
      allowed: false,
      used_bytes: EGRESS_ALLOWANCE,
      claimed_bytes: 0,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("usage_cap_reached");
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("signs nothing when the egress claim errors (fail closed, #16)", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/conversations", () => [{ id: CONV_ID }]);
    sb.on("GET", "/rest/v1/message_attachments", () => [
      {
        id: "10000000-0000-4000-8000-000000000001",
        storage_path: `mms-media/${COMPANY_ID}/msg-1/0`,
        content_type: "image/jpeg",
        size_bytes: 4096,
        created_at: "2026-07-02T09:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
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
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(500);
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("paginates: over the limit yields a next_cursor pointing at the last item", async () => {
    const sb = memberStub();
    // Three generic items, limit=2 → one extra → next_cursor from item #2.
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: "20000000-0000-4000-8000-000000000002",
        owner_type: "task",
        storage_path: `${COMPANY_ID}/task/t/a`,
        file_name: "a",
        content_type: "image/png",
        size_bytes: 1,
        created_at: "2026-07-02T13:00:00+00:00",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        owner_type: "note",
        storage_path: `${COMPANY_ID}/note/n/b`,
        file_name: "b",
        content_type: "image/png",
        size_bytes: 1,
        created_at: "2026-07-02T12:00:00+00:00",
      },
      {
        id: "40000000-0000-4000-8000-000000000004",
        owner_type: "note",
        storage_path: `${COMPANY_ID}/note/n/c`,
        file_name: "c",
        content_type: "image/png",
        size_bytes: 1,
        created_at: "2026-07-02T11:00:00+00:00",
      },
    ]);
    stubSigning(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments?limit=2`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string }[];
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).not.toBeNull();
    const cursor = decodeCursor(body.next_cursor!);
    expect(cursor.ts).toBe("2026-07-02T12:00:00+00:00");
    expect(cursor.id).toBe("30000000-0000-4000-8000-000000000003");
    // Both arms over-fetched limit+1 = 3.
    expect(sb.find("GET", "/rest/v1/attachments")[0].url.searchParams.get("limit")).toBe(
      "3",
    );
  });

  it("404s a conversation outside the caller's company before any arm fetch", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/conversations", () => []); // not in this company
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    expect(sb.find("GET", "/rest/v1/message_attachments")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/attachments")).toHaveLength(0);
  });

  it("returns an empty page with no signing when the conversation has no attachments", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], next_cursor: null });
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });
});

/**
 * #240 — a gallery is a wall of thumbnails, and fetching a 25 MB original for
 * each one was the single worst egress shape in the product.
 */
describe("the gallery serves derivatives", () => {
  it("signs the preview, charges for the preview, and keeps size_bytes honest", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: "40000000-0000-4000-8000-000000000004",
        owner_type: "note",
        storage_path: `${COMPANY_ID}/note/n1/uuid-roof.jpg`,
        preview_path: `${COMPANY_ID}/note/n1/preview-uuid-roof.jpg`,
        preview_bytes: 184320,
        file_name: "roof.jpg",
        content_type: "image/jpeg",
        size_bytes: 20971520,
        created_at: "2026-07-02T11:00:00+00:00",
      },
    ]);
    stubSigning(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { url: string; variant: string; size_bytes: number }[];
    };
    expect(body.data[0].variant).toBe("preview");
    expect(body.data[0].url).toContain("preview-uuid-roof.jpg");
    // `size_bytes` stays the ORIGINAL's. It is what a "20 MB" label means and
    // what a download will cost — a grid that reported 180 KB would be lying
    // about the file, not about the thumbnail.
    expect(body.data[0].size_bytes).toBe(20971520);

    // And the page claimed what it served, not what the row weighs.
    const claim = sb.find(
      "POST",
      "/rest/v1/rpc/claim_signed_url_egress_objects",
    )[0];
    expect(claim.body).toMatchObject({
      p_objects: [
        {
          key: `attachments/${COMPANY_ID}/note/n1/preview-uuid-roof.jpg`,
          bytes: 184320,
        },
      ],
    });
  });

  it("falls back to the original for a row with no preview", async () => {
    // Everything uploaded before this shipped, plus every PDF and document —
    // which never get one, because a file row is not a picture.
    const sb = memberStub();
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/attachments", () => [
      {
        id: "50000000-0000-4000-8000-000000000005",
        owner_type: "task",
        storage_path: `${COMPANY_ID}/task/t1/uuid-quote.pdf`,
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 8192,
        created_at: "2026-07-02T11:00:00+00:00",
      },
    ]);
    stubSigning(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      data: { url: string; variant: string }[];
    };
    expect(body.data[0].variant).toBe("original");
    expect(body.data[0].url).toContain("uuid-quote.pdf");
  });

  it("says `original` for MMS media, which has no derivative", async () => {
    // Every inbound item is ≤1 MB by carrier limit (D28): the original IS the
    // bounded preview, and a second object would save a fraction of a fraction.
    const sb = memberStub();
    sb.on("GET", "/rest/v1/message_attachments", () => [
      {
        id: "60000000-0000-4000-8000-000000000006",
        storage_path: `mms-media/${COMPANY_ID}/msg-1/0`,
        content_type: "image/jpeg",
        size_bytes: 900000,
        created_at: "2026-07-02T09:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/attachments", () => []);
    stubSigning(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/attachments`,
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { variant: string }[] };
    expect(body.data[0].variant).toBe("original");
  });
});
