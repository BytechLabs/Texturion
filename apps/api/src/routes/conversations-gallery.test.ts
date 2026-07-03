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
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  // The conversation existence gate (findConversation).
  sb.on("GET", "/rest/v1/conversations", () => [{ id: CONV_ID }]);
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
      "GET",
      "/rest/v1/company_members",
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
