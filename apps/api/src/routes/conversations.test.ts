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
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "member"),
  );
  // #106: no access rules → every member unrestricted (today's default).
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  // #293: the detail route reads the caller's own deferral. "Not deferred" is
  // the state every test in this file was written against; the snooze suite
  // asserts on the write path, which is where the interesting behaviour is.
  sb.on("GET", "/rest/v1/conversation_snoozes", () => []);
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
      // #106: unrestricted callers pass null (no deny filter).
      p_hidden_number_ids: null,
      // #293: the ordinary inbox does not show what this member deferred, and
      // it says so on EVERY call rather than relying on the RPC's default —
      // one explicit value beats two places that have to agree.
      p_snoozed: "exclude",
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

  it("#293: the list defaults to hiding deferrals; ?snoozed= opts in or out", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    // A client that asks for nothing gets the ordinary inbox — minus what it
    // deferred. This is the assertion that "snooze" means something to a
    // caller written before #293 existed.
    const plain = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations",
      { companyId: COMPANY_ID },
    );
    expect(plain.status).toBe(200);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0].body,
    ).toMatchObject({ p_snoozed: "exclude" });

    for (const [value, expected] of [
      ["only", "only"], // the "what did I defer" view
      ["all", "all"], // deliberately opting out of the filter
    ] as const) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations?snoozed=${value}`,
        { companyId: COMPANY_ID },
      );
      expect(res.status).toBe(200);
      const calls = sb.find("POST", "/rest/v1/rpc/api_list_conversations");
      expect(calls[calls.length - 1].body).toMatchObject({
        p_snoozed: expected,
      });
    }

    const bad = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/conversations?snoozed=later",
      { companyId: COMPANY_ID },
    );
    expect(bad.status).toBe(422);
  });

  it("#13: GET /conversations/:id/pinned returns the conversation's pinned messages", async () => {
    const sb = memberStub();
    // Attachments ride the embedded message_attachments join (same as the
    // thread list), not a separate lookup.
    sb.on("GET", "/rest/v1/messages", () => [
      { id: "m2", conversation_id: CONV_ID, body: "gate code 1234", pinned_at: "2026-07-02T10:00:00+00:00", message_attachments: [] },
      { id: "m1", conversation_id: CONV_ID, body: "5 Main St", pinned_at: "2026-07-01T10:00:00+00:00", message_attachments: [] },
    ]);
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

    // The query filters pinned + orders pinned_at desc, company-scoped, and
    // fetches a NAMED column set — never `*` (which would drag body_tsv over
    // the wire) and never the internal COGS/idempotency columns the thread
    // list also omits.
    const msgReq = sb.find("GET", "/rest/v1/messages").at(-1)!;
    expect(msgReq.url.searchParams.get("pinned_at")).toBe("not.is.null");
    expect(msgReq.url.searchParams.get("order")).toContain("pinned_at.desc");
    expect(msgReq.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    const select = msgReq.url.searchParams.get("select") ?? "";
    expect(select).not.toBe("*");
    expect(select).not.toContain("provider_cost");
    expect(select).not.toContain("idempotency_key");
    expect(select).toContain("message_attachments");
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
    // Non-canonical numeric forms Number() would silently coerce must 422 too
    // (strict surface): 1e2→100, 0x19→25, 25.0, whitespace-padded.
    for (const qs of [
      "cursor=garbage",
      "limit=0",
      "limit=101",
      "status=bogus",
      "limit=1e2",
      "limit=0x19",
      "limit=25.0",
      "limit=%2025",
    ]) {
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
  // #225: the composer needs to know what time it is where they are, and it
  // must get that answer from the SAME module the send gate uses. A hint that
  // says one thing while the gate does another is worse than no hint, because
  // the person stops believing the next one.
  it("carries the destination clock, resolved by the send gate's own resolver", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        ...conversationRow(),
        // 613 is Ottawa: America/Toronto, and no contact override.
        contacts: {
          id: "dddddddd-1111-4222-8333-444444444444",
          name: "Jo",
          phone_e164: "+16135551000",
          timezone: null,
        },
        conversation_tags: [],
      },
    ]);
    sb.on("GET", "/rest/v1/messages", () => []);
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
    const clock = body.destination_clock as Record<string, unknown>;
    expect(clock).toMatchObject({
      timezone: "America/Toronto",
      // The provenance, so a screen can say "from their area code" rather than
      // presenting a guess as a fact.
      source: "area_code",
    });
    expect(typeof clock.local_hour).toBe("number");
    expect(typeof clock.quiet).toBe("boolean");
  });

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
    // #342: lifting the mark clears the review watermark too, so a later
    // re-mark counts fresh rather than inheriting a confirmation that was
    // about entirely different messages.
    expect(update2).toEqual({ is_spam: false, spam_reviewed_at: null });
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

describe("DELETE /v1/conversations/:id/read", () => {
  it("deletes the caller's conversation_reads row (mark unread)", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("DELETE", "/rest/v1/conversation_reads", () => new Response(null, { status: 204 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/read`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const del = sb.find("DELETE", "/rest/v1/conversation_reads")[0];
    expect(del.url.searchParams.get("conversation_id")).toBe(`eq.${CONV_ID}`);
    expect(del.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
  });

  it("404s for a conversation outside the company", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/read`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
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

  describe("@mentions", () => {
    const TEAMMATE = "eeeeeeee-1111-4222-8333-444444444444";
    const OUTSIDER = "ffffffff-1111-4222-8333-444444444444";

    /** The audience query listConversationViewers runs (select=user_id,role). */
    function viewersResponder(rows: { user_id: string; role: string }[]) {
      return (call: { url: URL }) =>
        call.url.searchParams.get("select") === "user_id,role" ? rows : undefined;
    }

    /**
     * #480: the same people, as the INVERSE resolver answers — every member with
     * their level on the conversation's number.
     *
     * Registered from the same list as `viewersResponder` so a fixture cannot
     * describe one audience to the member query and a different one to the
     * resolver. `level` defaults to 'text'; a test that needs somebody hidden
     * passes it explicitly.
     */
    function audience(
      sb: SupabaseStub,
      rows: { user_id: string; role: string; level?: string }[],
    ) {
      sb.on("GET", "/rest/v1/company_members", viewersResponder(rows));
      sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
        rows.map((row) => ({ ...row, level: row.level ?? "text" })),
      );
    }

    it("records a mention for a teammate who can see the thread", async () => {
      const sb = memberStub();
      audience(sb, [
        { user_id: auth.subject, role: "member" },
        { user_id: TEAMMATE, role: "member" },
      ]);
      sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
      sb.on("POST", "/rest/v1/messages", () =>
        Response.json([noteRow()], { status: 201 }),
      );
      sb.on("POST", "/rest/v1/message_mentions", () => new Response(null, { status: 201 }));
      sb.on("PATCH", "/rest/v1/conversations", () => new Response(null, { status: 204 }));
      sb.on("GET", "/rest/v1/notification_prefs", () => []);
      sb.on("GET", "/rest/v1/push_subscriptions", () => []);
      sb.on("GET", "/rest/v1/device_push_tokens", () => []);
      sb.on("GET", "/rest/v1/profiles", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/notes`,
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { body: "@Teammate can you check this?", mention_user_ids: [TEAMMATE] },
        },
      );

      expect(res.status).toBe(201);
      const rows = sb.find("POST", "/rest/v1/message_mentions")[0];
      expect(rows.body).toEqual([
        {
          message_id: NOTE_ID,
          user_id: TEAMMATE,
          company_id: COMPANY_ID,
          conversation_id: CONV_ID,
        },
      ]);
      // The body is untouched, so clients that know nothing about mentions
      // render the note exactly as typed.
      const insert = sb.find("POST", "/rest/v1/messages")[0];
      expect(insert.body).toMatchObject({ body: "@Teammate can you check this?" });
    });

    it("refuses a mention for someone who cannot see the conversation, saving nothing", async () => {
      // A note body quotes the customer, and the alert carries a snippet of it,
      // so an id outside the audience must never reach the table.
      const sb = memberStub();
      audience(sb, [{ user_id: auth.subject, role: "member" }]);
      sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/notes`,
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { body: "@Outsider look", mention_user_ids: [OUTSIDER] },
        },
      );

      expect(res.status).toBe(422);
      expect(sb.find("POST", "/rest/v1/messages")).toHaveLength(0);
      expect(sb.find("POST", "/rest/v1/message_mentions")).toHaveLength(0);
    });

    it("offers only teammates who can see the conversation", async () => {
      const sb = memberStub();
      audience(sb, [
        { user_id: auth.subject, role: "member" },
        { user_id: TEAMMATE, role: "member" },
      ]);
      sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
      sb.on("GET", "/rest/v1/profiles", () => [
        { user_id: TEAMMATE, display_name: "Sam Rivera" },
      ]);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/mentionable-members`,
        { companyId: COMPANY_ID },
      );

      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        data: { user_id: string; display_name: string }[];
      };
      expect(page.data).toContainEqual({
        user_id: TEAMMATE,
        role: "member",
        display_name: "Sam Rivera",
      });
      // Naming yourself sends no alert, so it is not offered.
      expect(page.data.map((row) => row.user_id)).not.toContain(auth.subject);
    });

    it("404s the picker for an unknown conversation", async () => {
      const sb = memberStub();
      sb.on("GET", "/rest/v1/conversations", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/mentionable-members`,
        { companyId: COMPANY_ID },
      );
      expect(res.status).toBe(404);
    });
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

  it("creates-or-reuses the tag on attach by name via the atomic find-or-create RPC", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("POST", "/rest/v1/rpc/api_find_or_create_tag", () => [
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
    // The atomic RPC (keyed on lower(name)) replaces the find/insert/re-select
    // dance and its create/select race.
    const rpc = sb.find("POST", "/rest/v1/rpc/api_find_or_create_tag")[0];
    expect(rpc.body).toEqual({ p_company_id: COMPANY_ID, p_name: "Follow up" });
  });

  it("attaches a tag whose name contains '*' — the raw name reaches the RPC (no escapeLike stripping)", async () => {
    // The old ilike lookup used escapeLike, which DELETES '*', so a name like
    // "VIP*" matched the wrong tag or 500'd on the second attach.
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () => [conversationRow()]);
    sb.on("POST", "/rest/v1/rpc/api_find_or_create_tag", () => [
      { id: TAG_ID, name: "VIP*", color: null },
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
      { method: "POST", companyId: COMPANY_ID, body: { name: "VIP*" } },
    );
    expect(res.status).toBe(201);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_find_or_create_tag")[0];
    expect(rpc.body).toEqual({ p_company_id: COMPANY_ID, p_name: "VIP*" });
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

describe("POST /v1/conversations/bulk (#275)", () => {
  function bulkStub(
    result: Record<string, unknown> = {
      action: "set_status",
      matched: 2,
      applied: [],
      failed: [],
      capped: false,
    },
  ): { sb: SupabaseStub; calls: Record<string, unknown>[] } {
    const sb = memberStub();
    const calls: Record<string, unknown>[] = [];
    sb.on("POST", "/rest/v1/rpc/api_bulk_conversations", (call) => {
      calls.push(call.body as Record<string, unknown>);
      return result;
    });
    return { sb, calls };
  }

  const post = async (body: unknown) =>
    apiRequest(app, env, await auth.token(), "/v1/conversations/bulk", {
      method: "POST",
      companyId: COMPANY_ID,
      body,
    });

  it("acts on everything matching the filter, not just a loaded page", async () => {
    // The headline case: back from a week off, close everything still open.
    // The client sends the FILTER — sending 340 ids would mean the client decided
    // which rows are in scope, and it does not know about the deny list.
    const { sb, calls } = bulkStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({
      action: "set_status",
      filter: { status: "open" },
      target_status: "closed",
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      p_action: "set_status",
      p_ids: null,
      p_status: "open",
      p_target_status: "closed",
    });
  });

  it("passes the caller's hidden numbers so the RPC can enforce #106", async () => {
    // The route cannot filter rows itself — it never sees them. What it MUST do
    // is hand over the deny list; forgetting it would make every bulk action
    // reach every number in the company.
    // Built without memberStub(), which registers an EMPTY number_access — and
    // an empty rule set means unrestricted, so the second handler would never be
    // consulted and the assertion would pass against a null it did not intend.
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    const calls: Record<string, unknown>[] = [];
    // One admins-only rule this member cannot match → that number is hidden.
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: "eeeeeeee-1111-4222-8333-444444444444", level: "none" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_bulk_conversations", (call) => {
      calls.push(call.body as Record<string, unknown>);
      return { action: "mark_read", matched: 0, applied: [], failed: [], capped: false };
    });
    stubFetch(jwksRoute(auth), sb.route);

    await post({ action: "mark_read", filter: { unread: true } });
    expect(calls[0].p_hidden_number_ids).not.toBeNull();
    expect(calls[0].p_hidden_number_ids).toContain(
      "eeeeeeee-1111-4222-8333-444444444444",
    );
  });

  it("refuses every shape of bulk send at the route, before the database", async () => {
    // The SQL enum is the backstop; this is the first gate. Multi-select plus a
    // compose box is a mass-texting tool and this product does not have one.
    const { sb, calls } = bulkStub();
    stubFetch(jwksRoute(auth), sb.route);

    for (const action of ["send", "bulk_send", "message", "text", "delete"]) {
      const res = await post({ action, ids: [CONV_ID] });
      expect(res.status, action).toBe(422);
    }
    // Nothing reached the database.
    expect(calls).toHaveLength(0);
  });

  it("refuses a request with neither ids nor filter", async () => {
    // Both absent would mean "every conversation in the company", which no UI
    // should be able to ask for by omitting a field.
    const { sb, calls } = bulkStub();
    stubFetch(jwksRoute(auth), sb.route);

    expect((await post({ action: "mark_read" })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("surfaces the RPC's own coherence rejection as a 422", async () => {
    // e.g. an assign across a whole filter with no target user: the RPC refuses
    // rather than unassigning everything on screen.
    const { sb } = bulkStub({ error: "validation_failed" });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({ action: "assign", filter: { status: "open" } });
    expect(res.status).toBe(422);
  });

  it("returns the applied rows with prior values, and names what it could not reach", async () => {
    // The client builds its undo from `applied[].previous` and shows the failures
    // — a bulk action that half-worked must never render as a clean success.
    const { sb } = bulkStub({
      action: "set_status",
      matched: 3,
      applied: [
        { id: CONV_ID, previous: { status: "open" } },
        { id: "aaaaaaaa-2222-4222-8333-444444444444", previous: { status: "waiting" } },
      ],
      failed: [{ id: "aaaaaaaa-3333-4222-8333-444444444444", reason: "not_found" }],
      capped: false,
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post({
      action: "set_status",
      ids: [CONV_ID],
      target_status: "closed",
    });
    const body = (await res.json()) as {
      applied: { id: string; previous: { status: string } }[];
      failed: { id: string; reason: string }[];
      matched: number;
    };
    expect(body.applied).toHaveLength(2);
    expect(body.applied[0].previous.status).toBe("open");
    expect(body.applied[1].previous.status).toBe("waiting");
    expect(body.failed).toHaveLength(1);
    expect(body.matched).toBe(3);
  });

  it("escapes a search filter before it reaches the RPC", async () => {
    // The filter is echoed into an ilike inside the function, so a % typed into
    // the search box must not widen the selection.
    const { sb, calls } = bulkStub();
    stubFetch(jwksRoute(auth), sb.route);

    await post({ action: "mark_read", filter: { q: "50%" } });
    // escapeLike backslash-escapes the LIKE wildcards, so "50%" reaches the
    // function as the literal characters 5, 0, \, % — matching a contact called
    // "50%" rather than every contact starting with "50".
    expect(calls[0].p_q).toBe("50\\%");
  });
});

describe("#293 snooze routes", () => {
  // `found: false` is the other-company case. It has to be decided here rather
  // than overridden per-test: responders run in registration order, so a later
  // `on()` for the same path never wins.
  function snoozeStub(found = true) {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/conversations", () =>
      found ? [conversationRow()] : [],
    );
    const writes: { method: string; body: unknown }[] = [];
    sb.on("POST", "/rest/v1/conversation_snoozes", (req) => {
      writes.push({ method: "POST", body: req.body });
      return new Response(null, { status: 201 });
    });
    sb.on("DELETE", "/rest/v1/conversation_snoozes", (req) => {
      writes.push({ method: "DELETE", body: req.url });
      return new Response(null, { status: 204 });
    });
    return { sb, writes };
  }

  const soon = () => new Date(Date.now() + 86_400_000).toISOString();

  it("defers the thread for the caller, with the note they left", async () => {
    const { sb, writes } = snoozeStub();
    stubFetch(jwksRoute(auth), sb.route);

    const until = soon();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/snooze`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { until, note: "waiting on the supplier" },
      },
    );
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      company_id: COMPANY_ID,
      conversation_id: CONV_ID,
      // The deferral is keyed to the PERSON, never the workspace — a colleague
      // must still see the thread.
      user_id: auth.subject,
      until: new Date(until).toISOString(),
      note: "waiting on the supplier",
    });
  });

  it("refuses a return time in the past rather than accepting a no-op", async () => {
    // Accepting it would hide the thread for zero seconds and then simply not.
    // That is indistinguishable from a broken feature, so it is a 422.
    const { sb, writes } = snoozeStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/snooze`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { until: new Date(Date.now() - 60_000).toISOString() },
      },
    );
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("refuses a return time past the cap, and a note past the column check", async () => {
    const { sb, writes } = snoozeStub();
    stubFetch(jwksRoute(auth), sb.route);

    const tooFar = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/snooze`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: {
          until: new Date(Date.now() + 400 * 86_400_000).toISOString(),
        },
      },
    );
    expect(tooFar.status).toBe(422);

    // 120 chars is the CHECK on the column. Catching it here turns a 500 from
    // Postgres into the ordinary validation envelope every client handles.
    const tooLong = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/snooze`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { until: soon(), note: "x".repeat(121) },
      },
    );
    expect(tooLong.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("rides the thread payload, so a deep-linked thread knows it is deferred", async () => {
    // Without this the only place the state exists is the list row, and a
    // thread opened from search or a notification would offer no way back —
    // it would just re-hide itself the next time the inbox loaded.
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/conversation_snoozes", () => [
      { until: "2026-08-06T15:00:00+00:00", note: "waiting on the supplier" },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { ...conversationRow(), contacts: { id: "d", name: "Jo" }, conversation_tags: [] },
    ]);
    sb.on("GET", "/rest/v1/messages", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      snoozed_until: "2026-08-06T15:00:00+00:00",
      snooze_note: "waiting on the supplier",
    });

    // Read as the CALLER's deferral, not the thread's — a colleague's snooze
    // must not show up here.
    const read = sb.find("GET", "/rest/v1/conversation_snoozes")[0];
    expect(read.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("brings it back in one tap, idempotently", async () => {
    const { sb, writes } = snoozeStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONV_ID}/snooze`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    expect(writes[0].method).toBe("DELETE");
    // Scoped to the caller: un-snoozing must not clear a colleague's deferral.
    expect(String(writes[0].body)).toContain(`user_id=eq.${auth.subject}`);
  });

  it("404s on another company's conversation before writing anything", async () => {
    const { sb, writes } = snoozeStub(false);
    stubFetch(jwksRoute(auth), sb.route);

    for (const method of ["POST", "DELETE"] as const) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/conversations/${CONV_ID}/snooze`,
        {
          method,
          companyId: COMPANY_ID,
          ...(method === "POST" ? { body: { until: soon() } } : {}),
        },
      );
      expect(res.status).toBe(404);
    }
    expect(writes).toHaveLength(0);
  });
});
