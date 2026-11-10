/**
 * #689 E: a task's history and comments. Real middleware and route code; the
 * network edge (PostgREST over fetch) is the only stub.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { notifyTaskChangeSafely } from "../tasks/notify";
import { taskActivityRoutes } from "./task-activity";

// The alerts have their own suite (tasks/notify.test.ts); here they are only
// asked whether the route raised them, for whom, and in what order.
vi.mock("../tasks/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/notify")>()),
  notifyTaskChangeSafely: vi.fn(async () => undefined),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const TASK_ID = "cccccccc-1111-4222-8333-444444444444";
const COMMENT_ID = "dddddddd-1111-4222-8333-444444444444";
const OTHER_USER = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(taskActivityRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(notifyTaskChangeSafely).mockClear();
});

function harness(
  role: string,
  opts: { taskFound?: boolean; author?: string } = {},
) {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(auth.subject, role),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/tasks", () =>
    opts.taskFound === false ? [] : [{ id: TASK_ID, conversation_id: null }],
  );
  sb.on("GET", "/rest/v1/profiles", () => [
    { user_id: auth.subject, display_name: "Rehman" },
    { user_id: OTHER_USER, display_name: "Sam" },
  ]);
  sb.on("GET", "/rest/v1/attachments", () => []);
  sb.on("GET", "/rest/v1/company_members", () => [
    { user_id: auth.subject },
    { user_id: OTHER_USER },
  ]);
  sb.on("POST", "/rest/v1/rpc/task_subscribe", () => null);
  sb.on("POST", "/rest/v1/rpc/task_unsubscribe", () => null);
  sb.on("GET", "/rest/v1/task_comments", () => [
    { id: COMMENT_ID, author_user_id: opts.author ?? auth.subject },
  ]);
  return sb;
}

describe("GET /v1/tasks/:id/activity", () => {
  it("returns the page oldest first with names, and a cursor when older entries exist", async () => {
    const sb = harness("member");
    sb.on("POST", "/rest/v1/rpc/api_task_activity", () => ({
      outcome: "ok",
      items: [
        {
          kind: "comment",
          id: "a0000000-0000-4000-8000-000000000003",
          at: "2026-11-10T12:00:00.000Z",
          user_id: auth.subject,
          detail: { body: "On my way", edited_at: null },
        },
        {
          kind: "event",
          id: "a0000000-0000-4000-8000-000000000002",
          at: "2026-11-10T11:00:00.000Z",
          user_id: auth.subject,
          detail: { event: "assignee", from: null, to: OTHER_USER },
        },
        {
          kind: "event",
          id: "a0000000-0000-4000-8000-000000000001",
          at: "2026-11-10T10:00:00.000Z",
          user_id: auth.subject,
          detail: { event: "created", from: null, to: "Fix furnace" },
        },
      ],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/activity?limit=2`,
      { companyId: COMPANY_ID },
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: Record<string, unknown>[];
      next_cursor: string | null;
    };
    expect(json.data.map((d) => d.kind)).toEqual(["event", "comment"]);
    expect(json.data[1]).toMatchObject({
      body: "On my way",
      author: { display_name: "Rehman" },
      attachments: [],
    });
    expect(json.data[0]).toMatchObject({
      event: "assignee",
      to_user: { display_name: "Sam" },
      actor: { display_name: "Rehman" },
    });
    expect(json.next_cursor).not.toBeNull();
    const call = sb.find("POST", "/rest/v1/rpc/api_task_activity")[0];
    expect(JSON.stringify(call)).toContain('"p_limit":3');
  });

  it("names the person on an assignee_added and an assignee_removed event (#689 C)", async () => {
    const sb = harness("member");
    sb.on("POST", "/rest/v1/rpc/api_task_activity", () => ({
      outcome: "ok",
      items: [
        {
          kind: "event",
          id: "a0000000-0000-4000-8000-000000000012",
          at: "2026-11-10T11:00:00.000Z",
          user_id: auth.subject,
          detail: { event: "assignee_removed", from: OTHER_USER, to: null },
        },
        {
          kind: "event",
          id: "a0000000-0000-4000-8000-000000000011",
          at: "2026-11-10T10:00:00.000Z",
          user_id: auth.subject,
          detail: { event: "assignee_added", from: null, to: OTHER_USER },
        },
      ],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/activity`,
      { companyId: COMPANY_ID },
    );
    const json = (await response.json()) as { data: Record<string, unknown>[] };
    expect(json.data[0]).toMatchObject({
      event: "assignee_added",
      to_user: { display_name: "Sam" },
    });
    expect(json.data[1]).toMatchObject({
      event: "assignee_removed",
      from_user: { display_name: "Sam" },
    });
  });

  it("is a 404 when the task is hidden from the caller", async () => {
    const sb = harness("member");
    sb.on("POST", "/rest/v1/rpc/api_task_activity", () => ({
      outcome: "not_found",
    }));
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/activity`,
      { companyId: COMPANY_ID },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a garbage cursor with 422", async () => {
    const sb = harness("member");
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/activity?cursor=nope`,
      { companyId: COMPANY_ID },
    );
    expect(response.status).toBe(422);
  });
});

describe("POST /v1/tasks/:id/comments", () => {
  it("creates a comment as the caller", async () => {
    const sb = harness("member");
    sb.on("POST", "/rest/v1/task_comments", () => [
      {
        id: COMMENT_ID,
        author_user_id: auth.subject,
        body: "Bring the long ladder",
        created_at: "2026-11-10T12:00:00.000Z",
        edited_at: null,
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/comments`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { body: "  Bring the long ladder " },
      },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      kind: "comment",
      body: "Bring the long ladder",
      author: { display_name: "Rehman" },
    });
    const insert = sb.find("POST", "/rest/v1/task_comments")[0];
    expect(JSON.stringify(insert)).toContain(COMPANY_ID);
    expect(JSON.stringify(insert)).toContain("Bring the long ladder");
  });

  it("422s an empty body and 404s a task the caller cannot see", async () => {
    const sb = harness("member", { taskFound: false });
    stubFetch(jwksRoute(auth), sb.route);
    const empty = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/comments`,
      { method: "POST", companyId: COMPANY_ID, body: { body: "   " } },
    );
    expect(empty.status).toBe(422);
    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/comments`,
      { method: "POST", companyId: COMPANY_ID, body: { body: "hello" } },
    );
    expect(missing.status).toBe(404);
  });

  it("is refused to a read-only member", async () => {
    const sb = harness("read_only");
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/comments`,
      { method: "POST", companyId: COMPANY_ID, body: { body: "hello" } },
    );
    expect(response.status).toBe(403);
  });
});

describe("PATCH and DELETE /v1/tasks/:id/comments/:commentId", () => {
  const path = `/v1/tasks/${TASK_ID}/comments/${COMMENT_ID}`;

  it("lets only the author edit", async () => {
    const sb = harness("admin", { author: OTHER_USER });
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(app, env, await auth.token(), path, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { body: "edited" },
    });
    expect(response.status).toBe(403);
  });

  it("stamps edited_at when the author edits", async () => {
    const sb = harness("member");
    sb.on("PATCH", "/rest/v1/task_comments", () => [
      {
        id: COMMENT_ID,
        author_user_id: auth.subject,
        body: "edited",
        created_at: "2026-11-10T12:00:00.000Z",
        edited_at: "2026-11-10T12:05:00.000Z",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const response = await apiRequest(app, env, await auth.token(), path, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { body: "edited" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ body: "edited" });
    expect(
      JSON.stringify(sb.find("PATCH", "/rest/v1/task_comments")[0]),
    ).toContain("edited_at");
  });

  it("refuses a member deleting another member's comment and allows an admin", async () => {
    const denied = harness("member", { author: OTHER_USER });
    stubFetch(jwksRoute(auth), denied.route);
    const refused = await apiRequest(app, env, await auth.token(), path, {
      method: "DELETE",
      companyId: COMPANY_ID,
    });
    expect(refused.status).toBe(403);
    vi.unstubAllGlobals();

    const allowed = harness("admin", { author: OTHER_USER });
    allowed.on("PATCH", "/rest/v1/task_comments", () => [{ id: COMMENT_ID }]);
    allowed.on("PATCH", "/rest/v1/attachments", () => []);
    stubFetch(jwksRoute(auth), allowed.route);
    const ok = await apiRequest(app, env, await auth.token(), path, {
      method: "DELETE",
      companyId: COMPANY_ID,
    });
    expect(ok.status).toBe(204);
    expect(allowed.find("PATCH", "/rest/v1/attachments").length).toBe(1);
  });
});

describe("task comments raise subscriber alerts (#689 D)", () => {
  const post = async (sb: ReturnType<typeof harness>, body: Record<string, unknown>) => {
    sb.on("POST", "/rest/v1/task_comments", () => [
      {
        id: COMMENT_ID,
        author_user_id: auth.subject,
        body: String(body.body),
        created_at: "2026-11-10T12:00:00.000Z",
        edited_at: null,
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(app, env, await auth.token(), `/v1/tasks/${TASK_ID}/comments`, {
      method: "POST",
      companyId: COMPANY_ID,
      body,
    });
  };
  const alerts = () => vi.mocked(notifyTaskChangeSafely).mock.calls.map((c) => c[1]);

  it("a plain comment alerts the followers and does not re-subscribe the author", async () => {
    const sb = harness("member");
    const response = await post(sb, { body: "Parts arrive Friday" });
    expect(response.status).toBe(201);

    expect(alerts()).toEqual([
      expect.objectContaining({
        kind: "comment",
        taskId: TASK_ID,
        actorUserId: auth.subject,
        commentBody: "Parts arrive Friday",
        mentionedUserIds: [],
      }),
    ]);
    // The author's subscription is the insert trigger's business, and it never
    // overrides an unfollow; the route must not force one.
    expect(sb.find("POST", "/rest/v1/rpc/task_subscribe")).toHaveLength(0);
  });

  it("a mention subscribes the person (lifting an unfollow) and alerts them, then the comment alert skips them", async () => {
    const sb = harness("member");
    const response = await post(sb, {
      body: "Sam, can you take this?",
      mention_user_ids: [OTHER_USER],
    });
    expect(response.status).toBe(201);

    const subscribe = sb.find("POST", "/rest/v1/rpc/task_subscribe");
    expect(subscribe).toHaveLength(1);
    expect(subscribe[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_user_id: OTHER_USER,
      p_reason: "mentioned",
      p_resubscribe: true,
    });
    expect(alerts().map((a) => a.kind)).toEqual(["mentioned", "comment"]);
    expect(alerts()[0]).toMatchObject({ mentionedUserIds: [OTHER_USER] });
    expect(alerts()[1]).toMatchObject({ mentionedUserIds: [OTHER_USER] });
  });

  it("naming yourself is not a mention", async () => {
    const sb = harness("member");
    await post(sb, { body: "note to self", mention_user_ids: [auth.subject] });
    expect(sb.find("POST", "/rest/v1/rpc/task_subscribe")).toHaveLength(0);
    expect(alerts().map((a) => a.kind)).toEqual(["comment"]);
  });

  it("refuses to name someone who cannot see the task, and writes nothing", async () => {
    const sb = harness("member");
    const stranger = "0f0f0f0f-0000-4000-8000-0000000000aa";
    const response = await post(sb, { body: "hi", mention_user_ids: [stranger] });
    expect(response.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/task_comments")).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
  });

  it("allows at most ten mentions", async () => {
    const sb = harness("member");
    const ids = Array.from(
      { length: 11 },
      (_, i) => `0f0f0f0f-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const response = await post(sb, { body: "everyone", mention_user_ids: ids });
    expect(response.status).toBe(422);
  });
});

describe("POST and DELETE /v1/tasks/:id/subscription (#689 D)", () => {
  const call = async (method: "POST" | "DELETE") =>
    apiRequest(app, env, await auth.token(), `/v1/tasks/${TASK_ID}/subscription`, {
      method,
      companyId: COMPANY_ID,
    });

  it("Follow subscribes the caller as a manual follower, lifting an earlier unfollow", async () => {
    const sb = harness("member");
    stubFetch(jwksRoute(auth), sb.route);
    const response = await call("POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subscribed: true });
    expect(sb.find("POST", "/rest/v1/rpc/task_subscribe")[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_user_id: auth.subject,
      p_reason: "manual",
      p_resubscribe: true,
    });
  });

  it("Unfollow records the unfollow for the caller only", async () => {
    const sb = harness("member");
    stubFetch(jwksRoute(auth), sb.route);
    const response = await call("DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subscribed: false });
    expect(sb.find("POST", "/rest/v1/rpc/task_unsubscribe")[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_user_id: auth.subject,
    });
  });

  it("a read-only member may follow: it asks for pushes, it writes nothing to the task", async () => {
    const sb = harness("read_only");
    stubFetch(jwksRoute(auth), sb.route);
    expect((await call("POST")).status).toBe(200);
  });

  it("is a 404 for a task the caller cannot see", async () => {
    const sb = harness("member", { taskFound: false });
    stubFetch(jwksRoute(auth), sb.route);
    expect((await call("POST")).status).toBe(404);
    expect((await call("DELETE")).status).toBe(404);
    expect(sb.find("POST", "/rest/v1/rpc/task_subscribe")).toHaveLength(0);
  });
});
