/**
 * Conversation routes (SPEC §6, §7): cursor list filter composition, detail
 * with embedded messages, PATCH event emission per changed field, read
 * upsert, events timeline, create-on-attach tags.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { encodeCursor } from "../http/pagination";
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
import { conversationsRoutes } from "./conversations";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const TAG_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const ASSIGNEE = "cccccccc-1111-4222-8333-444444444444";

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
  return sb;
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    company_id: COMPANY_ID,
    contact_id: "dddddddd-1111-4222-8333-444444444444",
    phone_number_id: "eeeeeeee-1111-4222-8333-444444444444",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    last_message_at: "2026-07-01T10:00:00+00:00",
    closed_at: null,
    created_at: "2026-06-30T10:00:00+00:00",
    updated_at: "2026-07-01T10:00:00+00:00",
    ...overrides,
  };
}

describe("GET /v1/conversations (cursor + filter composition)", () => {
  it("passes every filter and the decoded cursor to api_list_conversations", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const cursor = encodeCursor({
      ts: "2026-07-01T10:00:00+00:00",
      id: CONV_ID,
    });
    const qs = new URLSearchParams({
      status: "open",
      assigned_user_id: ASSIGNEE,
      tag_id: TAG_ID,
      is_spam: "false",
      unread: "true",
      q: "smith_50%",
      limit: "10",
      cursor,
    });
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations?${qs.toString()}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], next_cursor: null });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_limit: 11, // limit + 1 sentinel row
      p_status: "open",
      p_assigned_user_id: ASSIGNEE,
      p_tag_id: TAG_ID,
      p_is_spam: false,
      p_unread: true,
      p_q: "smith\\_50\\%", // LIKE wildcards escaped
      p_cursor_ts: "2026-07-01T10:00:00+00:00",
      p_cursor_id: CONV_ID,
      p_pinned: null,
    });
  });

  it("defaults: limit 25, spam excluded, no filters", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0];
    expect(rpc.body).toMatchObject({
      p_limit: 26,
      p_status: null,
      p_is_spam: false,
      p_unread: false,
      p_q: null,
      p_cursor_ts: null,
    });
  });

  it("#13: ?pinned=only forwards p_pinned; a bad value is rejected (422)", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const ok = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations?pinned=only",
      { companyId: COMPANY_ID },
    );
    expect(ok.status).toBe(200);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0].body,
    ).toMatchObject({ p_pinned: "only" });

    const bad = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations?pinned=sometimes",
      { companyId: COMPANY_ID },
    );
    expect(bad.status).toBe(422);
  });

  it("#13: GET /conversations/:id/pinned returns the conversation's pinned messages", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/messages", () => [
      { id: "m2", conversation_id: CONV_ID, company_id: COMPANY_ID, body: "gate code 1234", pinned_at: "2026-07-02T10:00:00+00:00" },
      { id: "m1", conversation_id: CONV_ID, company_id: COMPANY_ID, body: "5 Main St", pinned_at: "2026-07-01T10:00:00+00:00" },
    ]);
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/pinned`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; attachments: unknown[]; body_tsv?: unknown }[];
    };
    expect(body.data.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(body.data[0].attachments).toEqual([]);
    expect(body.data[0]).not.toHaveProperty("body_tsv");

    // The query filters pinned + orders pinned_at desc, company-scoped.
    const msgReq = sb.find("GET", "/rest/v1/messages").at(-1)!;
    expect(msgReq.url.searchParams.get("pinned_at")).toBe("not.is.null");
    expect(msgReq.url.searchParams.get("order")).toContain("pinned_at.desc");
    expect(msgReq.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("pages: limit+1 rows in → limit rows out with a next_cursor on the last row", async () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      conversationRow({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        last_message_at: `2026-07-01T10:00:${String(59 - i).padStart(2, "0")}+00:00`,
      }),
    );
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => rows);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      data: { id: string }[];
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(25);
    expect(body.next_cursor).toBe(
      encodeCursor({
        ts: "2026-07-01T10:00:35+00:00",
        id: "00000000-0000-4000-8000-000000000024",
      }),
    );
  });

  it("422s on a garbage cursor and an out-of-range limit", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const qs of ["cursor=garbage", "limit=0", "limit=101", "status=bogus"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations?${qs}`,
        { companyId: COMPANY_ID },
      );
      expect(res.status, qs).toBe(422);
    }
  });
});

describe("GET /v1/conversations/:id (embedded first message page)", () => {
  it("returns conversation + contact + tags + messages page with attachments", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        ...conversationRow(),
        contacts: { id: "dddddddd-1111-4222-8333-444444444444", name: "Jo" },
        conversation_tags: [
          { tags: { id: TAG_ID, name: "Won", color: null } },
        ],
      },
    ]);
    sb.on("GET", "/rest/v1/messages", () => [
      {
        id: "99999999-1111-4222-8333-444444444444",
        conversation_id: CONV_ID,
        direction: "inbound",
        body: "hi",
        status: "received",
        created_at: "2026-07-01T10:00:00+00:00",
        message_attachments: [
          { id: "77777777-1111-4222-8333-444444444444", content_type: "image/png", size_bytes: 123 },
        ],
      },
    ]);
    // T5.1: the embedded page annotates has_task + promoted_task from a batch
    // tasks lookup. Promote the one message so the embed flags it.
    sb.on("GET", "/rest/v1/tasks", () => [
      {
        id: "aaaaaaaa-1111-4222-8333-444444444444",
        title: "Order the part",
        message_id: "99999999-1111-4222-8333-444444444444",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.contact).toMatchObject({ name: "Jo" });
    expect(body.tags).toEqual([{ id: TAG_ID, name: "Won", color: null }]);
    const messages = body.messages as {
      data: {
        attachments: unknown[];
        has_task: boolean;
        promoted_task: { id: string; title: string } | null;
      }[];
      next_cursor: string | null;
    };
    expect(messages.data[0].attachments).toEqual([
      {
        id: "77777777-1111-4222-8333-444444444444",
        content_type: "image/png",
        size_bytes: 123,
      },
    ]);
    expect(messages.data[0].has_task).toBe(true);
    expect(messages.data[0].promoted_task).toEqual({
      id: "aaaaaaaa-1111-4222-8333-444444444444",
      title: "Order the part",
    });
    expect(messages.next_cursor).toBeNull();

    // The messages page is company-scoped and newest-first with limit 50+1.
    const msgCall = sb.find("GET", "/rest/v1/messages")[0];
    expect(msgCall.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(msgCall.url.searchParams.get("limit")).toBe("51");
    // D14: the embedded first page carries the done fields too.
    expect(msgCall.url.searchParams.get("select")).toContain("done_at");
    expect(msgCall.url.searchParams.get("select")).toContain("done_by_user_id");
  });

  it("404s for another company's conversation and malformed ids", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    for (const id of [CONV_ID, "not-a-uuid"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${id}`,
        { companyId: COMPANY_ID },
      );
      expect(res.status).toBe(404);
    }
  });
});

describe("PATCH /v1/conversations/:id (events per changed field)", () => {
  function patchStub(current: Record<string, unknown>): SupabaseStub {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [current]);
    sb.on("PATCH", "/rest/v1/conversations", (call) => [
      { ...current, ...(call.body as Record<string, unknown>) },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    return sb;
  }

  it("status change: sets closed_at when closing and emits status_changed", async () => {
    const sb = patchStub(conversationRow({ status: "open" }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { status: "closed" } },
    );
    expect(res.status).toBe(200);

    const update = sb.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(update.status).toBe("closed");
    expect(typeof update.closed_at).toBe("string");

    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        conversation_id: CONV_ID,
        actor_user_id: auth.subject,
        type: "status_changed",
        payload: { from: "open", to: "closed" },
      }),
    ]);
  });

  it("reopening clears closed_at", async () => {
    const sb = patchStub(
      conversationRow({ status: "closed", closed_at: "2026-06-30T00:00:00+00:00" }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { status: "open" },
    });
    const update = sb.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(update).toMatchObject({ status: "open", closed_at: null });
  });

  it("assignment change validates the assignee is an active member and emits assigned", async () => {
    const sb = patchStub(conversationRow());
    // Route-level assignee probe (select=id) — falls through membershipResponder.
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("select") === "id" &&
      call.url.searchParams.get("user_id") === `eq.${ASSIGNEE}`
        ? [{ id: "f0f0f0f0-1111-4222-8333-444444444444" }]
        : undefined,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { assigned_user_id: ASSIGNEE },
      },
    );
    expect(res.status).toBe(200);
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "assigned",
        payload: { from: null, to: ASSIGNEE },
      }),
    ]);
  });

  it("422s when the assignee is not an active member", async () => {
    const sb = patchStub(conversationRow());
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("select") === "id" ? [] : undefined,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { assigned_user_id: ASSIGNEE },
      },
    );
    expect(res.status).toBe(422);
  });

  it("two changed fields → two events (status + assignment)", async () => {
    const sb = patchStub(conversationRow({ status: "new" }));
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("select") === "id"
        ? [{ id: "f0f0f0f0-1111-4222-8333-444444444444" }]
        : undefined,
    );
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { status: "open", assigned_user_id: ASSIGNEE },
    });
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as { type: string }[];
    expect(events.map((e) => e.type).sort()).toEqual([
      "assigned",
      "status_changed",
    ]);
  });

  it("is_spam=true forces closed and emits spam_marked; un-spam stays closed", async () => {
    const sb = patchStub(conversationRow({ status: "open" }));
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { is_spam: true },
    });
    const update = sb.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(update.is_spam).toBe(true);
    expect(update.status).toBe("closed");
    expect(typeof update.closed_at).toBe("string");
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as { type: string }[];
    expect(events.map((e) => e.type)).toEqual(["spam_marked"]);

    // un-spam: flag cleared, conversation NOT reopened
    const sb2 = patchStub(
      conversationRow({
        status: "closed",
        is_spam: true,
        closed_at: "2026-06-30T00:00:00+00:00",
      }),
    );
    vi.unstubAllGlobals();
    stubFetch(jwksRoute(auth), sb2.route);
    await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { is_spam: false },
    });
    const update2 = sb2.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(update2).toEqual({ is_spam: false });
    const events2 = sb2.find("POST", "/rest/v1/conversation_events")[0]
      .body as { type: string }[];
    expect(events2.map((e) => e.type)).toEqual(["spam_unmarked"]);
  });

  it("no-op patch (same values) writes no update and no events", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [
      conversationRow({ status: "open" }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { status: "open" } },
    );
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/conversations")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("422s an empty body", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(422);
  });

  it("pin: stamps pinned_at + pinned_by_user_id and emits NO audit event (#3)", async () => {
    const sb = patchStub(
      conversationRow({ pinned_at: null, pinned_by_user_id: null }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { pinned: true } },
    );
    expect(res.status).toBe(200);

    const update = sb.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(typeof update.pinned_at).toBe("string");
    expect(update.pinned_by_user_id).toBe(auth.subject);
    // A pin is organizational — no conversation_events row.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("unpin: clears both pin columns (#3)", async () => {
    const sb = patchStub(
      conversationRow({
        pinned_at: "2026-07-04T09:00:00+00:00",
        pinned_by_user_id: auth.subject,
      }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { pinned: false },
    });
    const update = sb.find("PATCH", "/rest/v1/conversations")[0]
      .body as Record<string, unknown>;
    expect(update).toMatchObject({ pinned_at: null, pinned_by_user_id: null });
  });

  it("pinning an already-pinned conversation is an idempotent no-op (#3)", async () => {
    const sb = patchStub(
      conversationRow({
        pinned_at: "2026-07-04T09:00:00+00:00",
        pinned_by_user_id: auth.subject,
      }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { pinned: true } },
    );
    expect(res.status).toBe(200);
    // Already pinned → the no-op guard returns current without an UPDATE.
    expect(sb.find("PATCH", "/rest/v1/conversations")).toHaveLength(0);
  });
});

describe("POST /v1/conversations/:id/read", () => {
  it("upserts conversation_reads for the caller", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("POST", "/rest/v1/conversation_reads", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/read`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const upsert = sb.find("POST", "/rest/v1/conversation_reads")[0];
    expect(upsert.body).toMatchObject({
      conversation_id: CONV_ID,
      user_id: auth.subject,
    });
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "conversation_id,user_id",
    );
    expect(upsert.headers.get("prefer")).toContain("resolution=merge-duplicates");
  });
});

describe("POST /v1/conversations/:id/notes", () => {
  const NOTE_ID = "abababab-1111-4222-8333-444444444444";

  function noteRow(overrides: Record<string, unknown> = {}) {
    return {
      id: NOTE_ID,
      conversation_id: CONV_ID,
      direction: "note",
      body: "Customer prefers mornings",
      status: null,
      segments: null,
      encoding: null,
      sent_by_user_id: auth.subject,
      error_code: null,
      error_detail: null,
      telnyx_message_id: null,
      done_at: null,
      done_by_user_id: null,
      task_id: null,
      created_at: "2026-07-01T11:00:00+00:00",
      ...overrides,
    };
  }

  it("inserts a direction='note' messages row (status NULL) and bumps activity", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("POST", "/rest/v1/messages", () => Response.json([noteRow()], { status: 201 }));
    sb.on("PATCH", "/rest/v1/conversations", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { body: "Customer prefers mornings" },
      },
    );
    expect(res.status).toBe(201);
    // An unlinked note carries task: null (no task_id in the body).
    expect(await res.json()).toEqual({
      ...noteRow(),
      attachments: [],
      task: null,
    });

    const insert = sb.find("POST", "/rest/v1/messages")[0];
    expect(insert.body).toMatchObject({
      company_id: COMPANY_ID,
      conversation_id: CONV_ID,
      direction: "note",
      body: "Customer prefers mornings",
      status: null,
      sent_by_user_id: auth.subject,
      task_id: null,
    });

    // last_message_at moves forward only (never backwards).
    const bump = sb.find("PATCH", "/rest/v1/conversations")[0];
    expect(bump.body).toEqual({ last_message_at: "2026-07-01T11:00:00+00:00" });
    expect(bump.url.searchParams.get("last_message_at")).toBe(
      "lt.2026-07-01T11:00:00+00:00",
    );
    expect(bump.url.searchParams.get("id")).toBe(`eq.${CONV_ID}`);
    expect(bump.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("allows an attachment-only note with an empty body (files upload later)", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("POST", "/rest/v1/messages", () =>
      Response.json([noteRow({ body: "" })], { status: 201 }),
    );
    sb.on("PATCH", "/rest/v1/conversations", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      { method: "POST", companyId: COMPANY_ID, body: { body: "" } },
    );
    expect(res.status).toBe(201);
    const insert = sb.find("POST", "/rest/v1/messages")[0];
    expect(insert.body).toMatchObject({ direction: "note", body: "" });
  });

  it("404s an unknown conversation without inserting", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      { method: "POST", companyId: COMPANY_ID, body: { body: "hello" } },
    );
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/messages")).toHaveLength(0);
  });

  it("links a note to a task in the same conversation (D-D) and returns the task chip", async () => {
    const TASK_ID = "cccccccc-1111-4222-8333-444444444444";
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    // The task-link validation lookup: a LIVE task in this conversation+company.
    sb.on("GET", "/rest/v1/tasks", () => [
      { id: TASK_ID, title: "Fix the sink" },
    ]);
    sb.on("POST", "/rest/v1/messages", () =>
      Response.json([noteRow({ task_id: TASK_ID })], { status: 201 }),
    );
    sb.on("PATCH", "/rest/v1/conversations", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { body: "Ordered the part", task_id: TASK_ID },
      },
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { task: unknown; task_id: string };
    expect(json.task).toEqual({ id: TASK_ID, title: "Fix the sink" });
    expect(json.task_id).toBe(TASK_ID);

    // The validation lookup was scoped to this conversation + company + live.
    const lookup = sb.find("GET", "/rest/v1/tasks")[0];
    expect(lookup.url.searchParams.get("id")).toBe(`eq.${TASK_ID}`);
    expect(lookup.url.searchParams.get("conversation_id")).toBe(`eq.${CONV_ID}`);
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("deleted_at")).toBe("is.null");

    // The insert carried the task_id.
    const insert = sb.find("POST", "/rest/v1/messages")[0];
    expect(insert.body).toMatchObject({ task_id: TASK_ID });
  });

  it("422s a note linked to a task outside the conversation, without inserting", async () => {
    const TASK_ID = "cccccccc-1111-4222-8333-444444444444";
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    // No live task in this conversation matches → validation fails.
    sb.on("GET", "/rest/v1/tasks", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { body: "stray note", task_id: TASK_ID },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/messages")).toHaveLength(0);
  });

  it("422s a missing body field (empty/whitespace is allowed — attachment-only)", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);

    // The `body` field is still required by the schema, but an empty/whitespace
    // value is now valid (an attachment-only note; files upload separately).
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/notes`,
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /v1/conversations/:id/events", () => {
  it("applies the keyset cursor and returns the page envelope", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("GET", "/rest/v1/conversation_events", () => [
      {
        id: "12121212-1111-4222-8333-444444444444",
        conversation_id: CONV_ID,
        actor_user_id: null,
        type: "status_changed",
        payload: {},
        created_at: "2026-07-01T09:00:00+00:00",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const cursor = encodeCursor({
      ts: "2026-07-01T10:00:00+00:00",
      id: CONV_ID,
    });
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/events?cursor=${cursor}&limit=10`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; next_cursor: null };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).toBeNull();

    const eventsCall = sb.find("GET", "/rest/v1/conversation_events")[0];
    expect(eventsCall.url.searchParams.get("or")).toBe(
      `(created_at.lt.2026-07-01T10:00:00+00:00,and(created_at.eq.2026-07-01T10:00:00+00:00,id.lt.${CONV_ID}))`,
    );
    expect(eventsCall.url.searchParams.get("limit")).toBe("11");
  });
});

describe("POST /v1/conversations/:id/tags (create-on-attach)", () => {
  it("attaches an existing tag by id and emits tag_added", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("GET", "/rest/v1/tags", () => [
      { id: TAG_ID, name: "Won", color: null },
    ]);
    sb.on("POST", "/rest/v1/conversation_tags", () => [
      { conversation_id: CONV_ID, tag_id: TAG_ID },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: TAG_ID, name: "Won", color: null });
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "tag_added",
        payload: { tag_id: TAG_ID, name: "Won" },
      }),
    ]);
  });

  it("creates the tag on attach by name when it does not exist", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("GET", "/rest/v1/tags", () => []); // no existing tag with that name
    sb.on("POST", "/rest/v1/tags", () => [
      { id: TAG_ID, name: "Follow up", color: null },
    ]);
    sb.on("POST", "/rest/v1/conversation_tags", () => [
      { conversation_id: CONV_ID, tag_id: TAG_ID },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { name: "Follow up" } },
    );
    expect(res.status).toBe(201);
    const created = sb.find("POST", "/rest/v1/tags")[0];
    expect(created.body).toEqual({ company_id: COMPANY_ID, name: "Follow up" });
  });

  it("recovers from a concurrent-create unique violation by re-selecting the winner", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    let lookups = 0;
    sb.on("GET", "/rest/v1/tags", () => {
      lookups += 1;
      // First lookup: not found. Second (after 23505): the winner's row.
      return lookups === 1 ? [] : [{ id: TAG_ID, name: "Won", color: null }];
    });
    sb.on("POST", "/rest/v1/tags", () => pgError("23505", "duplicate key"));
    sb.on("POST", "/rest/v1/conversation_tags", () => [
      { conversation_id: CONV_ID, tag_id: TAG_ID },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { name: "Won" } },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: TAG_ID });
  });

  it("already-attached tag: 200, no duplicate event", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("GET", "/rest/v1/tags", () => [
      { id: TAG_ID, name: "Won", color: null },
    ]);
    // ignoreDuplicates upsert returns no rows for an existing pair.
    sb.on("POST", "/rest/v1/conversation_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("404s a tag from another company; 422s when both/neither key given", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("GET", "/rest/v1/tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags`,
      { method: "POST", companyId: COMPANY_ID, body: { tag_id: TAG_ID } },
    );
    expect(missing.status).toBe(404);

    for (const body of [{}, { tag_id: TAG_ID, name: "Won" }]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/tags`,
        { method: "POST", companyId: COMPANY_ID, body },
      );
      expect(res.status).toBe(422);
    }
  });
});

describe("DELETE /v1/conversations/:id/tags/:tag_id", () => {
  it("detaches, emits tag_removed, 204", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("DELETE", "/rest/v1/conversation_tags", () => [{ tag_id: TAG_ID }]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as { type: string }[];
    expect(events.map((e) => e.type)).toEqual(["tag_removed"]);
  });

  it("404s when the tag is not attached", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("DELETE", "/rest/v1/conversation_tags", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/tags/${TAG_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });
});
