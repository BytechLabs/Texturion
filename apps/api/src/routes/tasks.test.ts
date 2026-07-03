/**
 * Tasks routes suite (D17 / TASKS.md T4, §7/§8/§10): promote-a-message with the
 * partial-unique one-per-message guard (409 conflict), the flat filtered list
 * (default Open·Mine + the D25 filters), the DERIVED completion (task status
 * reads the joined messages.done_at — there is no task-side done column), the
 * T2.1 task_created/assigned/due_set/deleted audit rows, and the delete role
 * gate (creator or owner/admin). Real middleware + product code; the ONLY thing
 * stubbed is the network edge (PostgREST HTTP over global fetch).
 */
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  restMatch,
  rpcMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { tasksRoutes } from "./tasks";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const TASK_ID = "77777777-0000-4000-8000-000000000077";
const OTHER_USER = "22222222-0000-4000-8000-000000000022";

let auth: TestAuth;
const env: Env = completeEnv();

/**
 * A fully-wired /v1 app. The caller's role is stamped by the company-context
 * middleware from the `company_members` response (see membersRoute), not by the
 * app itself, so one builder serves every role — the role a test wants is the
 * one its membersRoute(role) stub returns.
 */
function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("/v1/*", jwtAuth());
  app.use("/v1/*", companyContext());
  app.route("/v1", tasksRoutes);
  app.onError((error, c) =>
    error instanceof ApiError
      ? errorResponse(c, error.code, error.message)
      : c.json({ error: { code: "internal_error", message: String(error) } }, 500),
  );
  return app;
}

const memberApp = buildApp();

/**
 * company_members route for the company-context MIDDLEWARE only — it matches
 * the caller's own membership lookup (filtered on the caller's sub) and stamps
 * the role. Scoped to the caller's sub so a route-level assignee-membership
 * check (a different user_id) falls through to its own stub.
 */
function membersRoute(role: "member" | "admin" | "owner" = "member"): FetchRoute {
  const prefix = `${env.SUPABASE_URL}/rest/v1/company_members`;
  return (url) =>
    url.href.startsWith(prefix) &&
    url.searchParams.get("user_id") === `eq.${auth.subject}`
      ? Response.json([{ id: "11111111-0000-4000-8000-000000000011", role }])
      : undefined;
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    title: "Fix the leak",
    description: "",
    assigned_user_id: null,
    due_at: null,
    created_by_user_id: auth?.subject,
    created_at: "2026-07-02T12:00:00.000Z",
    updated_at: "2026-07-02T12:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function request(
  method: string,
  path: string,
  body?: unknown,
  app = memberApp,
): Promise<Response> {
  return app.fetch(
    new Request(`https://api.jobtext.app${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        "X-Company-Id": COMPANY_ID,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

// --------------------------------------------------------------------------
// POST /v1/tasks — promote a message (T4, T5.1)
// --------------------------------------------------------------------------
describe("POST /v1/tasks — promote a message", () => {
  // T3: the route calls the `create_task` security-definer RPC — ONE atomic
  // transaction that resolves conversation_id, validates the assignee, inserts
  // the task AND writes the task_created event. The suite stubs only that RPC
  // (the network edge), and asserts the route forwards the right params and maps
  // each `outcome` to the §7 error/HTTP surface.
  interface CreateStubs {
    rpc: Stub;
    all: FetchRoute[];
  }
  function createStubs(
    options: { outcome?: string; task?: Record<string, unknown> | null } = {},
  ): CreateStubs {
    const rpc = stubRoute(rpcMatch(env, "create_task"), (call) => {
      const params = call.body as Record<string, unknown>;
      const outcome = options.outcome ?? "created";
      if (outcome !== "created") return { outcome, task: null };
      // Mirror the RPC: default the title to the body snippet when p_title is
      // null; echo the forwarded params onto the returned row.
      const title =
        (params.p_title as string | null) ??
        "Hey the kitchen sink is leaking again";
      return {
        outcome: "created",
        task:
          options.task ??
          taskRow({
            title,
            description: (params.p_description as string | null) ?? "",
            assigned_user_id: params.p_assigned_user_id ?? null,
            due_at: params.p_due_at ?? null,
            created_by_user_id: params.p_actor_user_id,
          }),
      };
    });
    return { rpc, all: [jwksRoute(auth), membersRoute(), rpc.route] };
  }

  it("promotes a message via create_task: forwards params, defaults the title, 201", async () => {
    const stubs = createStubs();
    stubFetch(...stubs.all);

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
    });
    expect(response.status).toBe(201);

    // The route forwards the message + actor to the RPC; an absent title is
    // sent as null (the RPC seeds the snippet), and the RPC is company-scoped
    // via its p_company_id (§10) — the route never promotes a foreign message.
    const params = stubs.rpc.calls[0].body as Record<string, unknown>;
    expect(params).toMatchObject({
      p_company_id: COMPANY_ID,
      p_message_id: MESSAGE_ID,
      p_title: null,
      p_description: null,
      p_assigned_user_id: null,
      p_due_at: null,
      p_actor_user_id: auth.subject,
    });

    // The returned task (the RPC's row) is echoed to the client with the
    // snippet default applied.
    const body = (await response.json()) as { title: string };
    expect(body.title).toBe("Hey the kitchen sink is leaking again");
  });

  it("409 conflict on a second live promotion of the same message (partial-unique)", async () => {
    const stubs = createStubs({ outcome: "conflict" });
    stubFetch(...stubs.all);

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
    });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conflict");
    // The single RPC is the one-per-message arbiter (its partial-unique index).
    expect(stubs.rpc.calls).toHaveLength(1);
  });

  it("422 when the message is not in the caller's company", async () => {
    const stubs = createStubs({ outcome: "no_message" });
    stubFetch(...stubs.all);

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("422 when message_id is absent (standalone tasks are cut, T0.1)", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks", { title: "orphan" });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("422 when the assignee is not an active member", async () => {
    const stubs = createStubs({ outcome: "not_member" });
    stubFetch(...stubs.all);

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
      assigned_user_id: OTHER_USER,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("forwards a provided title verbatim to the RPC", async () => {
    const stubs = createStubs();
    stubFetch(...stubs.all);
    await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
      title: "Custom title",
    });
    expect(
      (stubs.rpc.calls[0].body as Record<string, unknown>).p_title,
    ).toBe("Custom title");
  });
});

// --------------------------------------------------------------------------
// GET /v1/tasks — filtered list + DERIVED completion (T6.1, T2)
// --------------------------------------------------------------------------
describe("GET /v1/tasks — list filters + derived status", () => {
  function listStub(rows: Record<string, unknown>[]): Stub {
    return stubRoute(restMatch(env, "GET", "tasks"), () => rows);
  }

  it("defaults to Open·Mine (status=open, assignee=me) with no params", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);

    const response = await request("GET", "/v1/tasks");
    expect(response.status).toBe(200);

    const q = list.calls[0].url.searchParams;
    // status=open → messages.done_at is null; assignee=me → the caller's sub.
    expect(q.get("messages.done_at")).toBe("is.null");
    expect(q.get("assigned_user_id")).toBe(`eq.${auth.subject}`);
    // Company-scoped, live rows only.
    expect(q.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(q.get("deleted_at")).toBe("is.null");
    // Inner-embed of the SOURCE message (disambiguated from the reverse
    // messages.task_id FK) drives the derived status.
    expect(q.get("select")).toContain("messages!message_id!inner");
  });

  it("derives done from the joined messages.done_at (no task-side column)", async () => {
    const list = listStub([
      taskRow({ id: TASK_ID, messages: { id: MESSAGE_ID, done_at: null } }),
      taskRow({
        id: "77777777-0000-4000-8000-000000000078",
        messages: { id: "m2", done_at: "2026-07-02T14:00:00.000Z" },
      }),
    ]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);

    const response = await request("GET", "/v1/tasks?status=done");
    const body = (await response.json()) as {
      data: { id: string; done: boolean; status: string; messages?: unknown }[];
    };
    // Row 1: done_at null → open. Row 2: done_at set → done. The join artifact
    // is stripped from the response (completion is derived, not stored).
    expect(body.data[0]).toMatchObject({ done: false, status: "open" });
    expect(body.data[1]).toMatchObject({ done: true, status: "done" });
    expect(body.data[0]).not.toHaveProperty("messages");
  });

  it("status=done filters the join with done_at not-null", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?status=done");
    expect(list.calls[0].url.searchParams.get("messages.done_at")).toBe(
      "not.is.null",
    );
  });

  it("overdue=true filters past-due AND not-done, keyed on due_at", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?overdue=true");
    const q = list.calls[0].url.searchParams;
    // due_at < now AND still open (a done task is never overdue).
    expect(q.get("due_at")?.startsWith("lt.")).toBe(true);
    expect(q.get("messages.done_at")).toBe("is.null");
    // due-sorted view → order by due_at NULLS LAST then id.
    expect(q.get("order")).toContain("due_at");
  });

  it("due-sorted page 2 seeks the (due_at NULLS LAST, id) keyset, not id alone", async () => {
    // Page 1 of a due_before view: 3 rows returned for limit=2 signals a next
    // page, so next_cursor is minted from the LAST kept row (Feb-due).
    const jan = taskRow({
      id: "77777777-0000-4000-8000-0000000000a1",
      due_at: "2026-08-01T00:00:00.000Z",
      messages: { id: "m1", done_at: null },
    });
    const feb = taskRow({
      id: "77777777-0000-4000-8000-0000000000a2",
      due_at: "2026-09-01T00:00:00.000Z",
      messages: { id: "m2", done_at: null },
    });
    const mar = taskRow({
      id: "77777777-0000-4000-8000-0000000000a3",
      due_at: "2026-10-01T00:00:00.000Z",
      messages: { id: "m3", done_at: null },
    });
    const page1 = listStub([jan, feb, mar]);
    stubFetch(jwksRoute(auth), membersRoute(), page1.route);
    const r1 = await request(
      "GET",
      "/v1/tasks?due_before=2026-12-01T00:00:00.000Z&limit=2",
    );
    const b1 = (await r1.json()) as { data: unknown[]; next_cursor: string };
    expect(b1.data).toHaveLength(2);
    expect(b1.next_cursor).toBeTruthy();
    // Page 1 keyset order is (due_at NULLS LAST, id).
    expect(page1.calls[0].url.searchParams.get("order")).toBe(
      "due_at.asc.nullslast,id.asc",
    );

    // Page 2 with that cursor: the outgoing `or=` filter must reproduce the
    // NULLS-LAST successor of (due_at=Feb, id=a2) — later dates, the same-date
    // tie-break on id, AND the whole null-due tail — NOT a bare `id.gt`.
    vi.unstubAllGlobals();
    const page2 = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), page2.route);
    await request(
      "GET",
      `/v1/tasks?due_before=2026-12-01T00:00:00.000Z&limit=2&cursor=${encodeURIComponent(
        b1.next_cursor,
      )}`,
    );
    const or = page2.calls[0].url.searchParams.get("or");
    expect(or).toContain("due_at.gt.2026-09-01T00:00:00.000Z");
    expect(or).toContain(
      "and(due_at.eq.2026-09-01T00:00:00.000Z,id.gt.77777777-0000-4000-8000-0000000000a2)",
    );
    expect(or).toContain("due_at.is.null");
    // The broken behaviour was a lone `id=gt.<cursor.id>` param; assert it's gone.
    expect(page2.calls[0].url.searchParams.get("id")).toBeNull();
  });

  it("a null-due page advances only within the NULLS-LAST tail", async () => {
    // Last kept row has due_at=null (deep in the tail): the cursor's `d` is
    // null, so page 2 seeks `due_at IS NULL AND id > cursor.id` only.
    const nullDue = taskRow({
      id: "77777777-0000-4000-8000-0000000000b1",
      due_at: null,
      messages: { id: "m1", done_at: null },
    });
    const nullDue2 = taskRow({
      id: "77777777-0000-4000-8000-0000000000b2",
      due_at: null,
      messages: { id: "m2", done_at: null },
    });
    const nullDue3 = taskRow({
      id: "77777777-0000-4000-8000-0000000000b3",
      due_at: null,
      messages: { id: "m3", done_at: null },
    });
    const page1 = listStub([nullDue, nullDue2, nullDue3]);
    stubFetch(jwksRoute(auth), membersRoute(), page1.route);
    const r1 = await request("GET", "/v1/tasks?due_after=2026-01-01T00:00:00.000Z&limit=2");
    const b1 = (await r1.json()) as { next_cursor: string };

    vi.unstubAllGlobals();
    const page2 = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), page2.route);
    await request(
      "GET",
      `/v1/tasks?due_after=2026-01-01T00:00:00.000Z&limit=2&cursor=${encodeURIComponent(
        b1.next_cursor,
      )}`,
    );
    expect(page2.calls[0].url.searchParams.get("or")).toBe(
      "(and(due_at.is.null,id.gt.77777777-0000-4000-8000-0000000000b2))",
    );
  });

  it("a created-sorted cursor is rejected on a due-sorted view (422)", async () => {
    // A token minted for the (created_at, id) view has no `d` field, so the
    // due-sorted view's decoder rejects it rather than silently mis-seeking.
    const page1 = listStub([
      taskRow({ id: "77777777-0000-4000-8000-0000000000c1", messages: { id: "m1", done_at: null } }),
      taskRow({ id: "77777777-0000-4000-8000-0000000000c2", messages: { id: "m2", done_at: null } }),
      taskRow({ id: "77777777-0000-4000-8000-0000000000c3", messages: { id: "m3", done_at: null } }),
    ]);
    stubFetch(jwksRoute(auth), membersRoute(), page1.route);
    // Created-sorted page 1 (a filter that is NOT due-sorted): q= keeps status
    // default off the due path.
    const r1 = await request("GET", "/v1/tasks?assigned_user_id=me&limit=2");
    const b1 = (await r1.json()) as { next_cursor: string };
    expect(b1.next_cursor).toBeTruthy();

    vi.unstubAllGlobals();
    stubFetch(jwksRoute(auth), membersRoute());
    const r2 = await request(
      "GET",
      `/v1/tasks?overdue=true&cursor=${encodeURIComponent(b1.next_cursor)}`,
    );
    expect(r2.status).toBe(422);
  });

  it("unassigned=true filters assigned_user_id is null", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?unassigned=true");
    expect(list.calls[0].url.searchParams.get("assigned_user_id")).toBe(
      "is.null",
    );
  });

  it("assigned_user_id=me resolves to the caller; an explicit id passes through", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", `/v1/tasks?assigned_user_id=${OTHER_USER}`);
    expect(list.calls[0].url.searchParams.get("assigned_user_id")).toBe(
      `eq.${OTHER_USER}`,
    );
  });

  it("has_location=true joins contacts and filters lat not-null", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?has_location=true");
    const q = list.calls[0].url.searchParams;
    expect(q.get("select")).toContain("contacts!inner");
    expect(q.get("conversations.contacts.lat")).toBe("not.is.null");
  });

  it("q applies a title trgm ilike (escaped)", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?q=leak");
    expect(list.calls[0].url.searchParams.get("title")).toBe("ilike.%leak%");
  });

  it("422s an unknown status value", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("GET", "/v1/tasks?status=blocked");
    expect(response.status).toBe(422);
  });
});

// --------------------------------------------------------------------------
// GET /v1/conversations/:id/tasks — the checklist (T5.2)
// --------------------------------------------------------------------------
describe("GET /v1/conversations/:id/tasks — checklist", () => {
  it("lists live tasks with derived done + attachment_count, no cursor", async () => {
    const convCheck = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { id: CONVERSATION_ID },
    ]);
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ id: TASK_ID, messages: { id: MESSAGE_ID, done_at: null } }),
    ]);
    const attach = stubRoute(restMatch(env, "GET", "attachments"), () => [
      { owner_id: TASK_ID },
      { owner_id: TASK_ID },
    ]);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      convCheck.route,
      list.route,
      attach.route,
    );

    const response = await request(
      "GET",
      `/v1/conversations/${CONVERSATION_ID}/tasks`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; done: boolean; attachment_count: number }[];
      next_cursor?: string;
    };
    expect(body).not.toHaveProperty("next_cursor");
    expect(body.data[0]).toMatchObject({
      id: TASK_ID,
      done: false,
      status: "open",
      attachment_count: 2,
    });
    // Checklist read is company-scoped + live-only, ordered created_at asc.
    const q = list.calls[0].url.searchParams;
    expect(q.get("conversation_id")).toBe(`eq.${CONVERSATION_ID}`);
    expect(q.get("deleted_at")).toBe("is.null");
    expect(q.get("order")).toContain("created_at.asc");
  });

  it("404s an unknown conversation", async () => {
    const convCheck = stubRoute(restMatch(env, "GET", "conversations"), () => []);
    stubFetch(jwksRoute(auth), membersRoute(), convCheck.route);
    const response = await request(
      "GET",
      `/v1/conversations/${CONVERSATION_ID}/tasks`,
    );
    expect(response.status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// GET /v1/tasks/:id — detail + merged activity feed (TASKS-V2 D-C + D-D)
// --------------------------------------------------------------------------
describe("GET /v1/tasks/:id — detail + activity", () => {
  it("returns detail plus the merged task_* events + linked notes, oldest-first", async () => {
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        messages: {
          id: MESSAGE_ID,
          body: "fix the sink",
          done_at: null,
          done_by_user_id: null,
          created_at: "2026-07-02T12:00:00.000Z",
          direction: "inbound",
        },
      }),
    ]);
    // profiles lookup (assignee/creator) — the route calls it up to twice.
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => [
      { user_id: auth.subject, display_name: "Sam" },
    ]);
    const attachments = stubRoute(
      restMatch(env, "GET", "attachments"),
      () => [],
    );
    // Activity arm 1: task_* conversation_events for this task.
    const events = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [
        {
          id: "eeeeeeee-0000-4000-8000-0000000000e1",
          type: "task_created",
          payload: { task_id: TASK_ID, message_id: MESSAGE_ID },
          actor_user_id: auth.subject,
          created_at: "2026-07-02T12:00:00.000Z",
        },
      ],
    );
    // Activity arm 2: task-linked notes (messages.task_id = TASK_ID).
    const notes = stubRoute(restMatch(env, "GET", "messages"), () => [
      {
        id: "dddddddd-0000-4000-8000-0000000000d1",
        body: "ordered the part",
        sent_by_user_id: auth.subject,
        created_at: "2026-07-02T13:00:00.000Z",
      },
    ]);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      detail.route,
      profiles.route,
      attachments.route,
      events.route,
      notes.route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activity: { kind: string; id: string; created_at: string }[];
      source_message: { id: string } | null;
    };
    expect(body.source_message).toMatchObject({ id: MESSAGE_ID });
    // Merged + sorted oldest-first: the create event (12:00) then the note (13:00).
    expect(body.activity.map((a) => a.kind)).toEqual(["event", "note"]);

    // The event arm filtered on the audit payload's task_id + the task types.
    const evq = events.calls[0].url.searchParams;
    expect(evq.get("payload->>task_id")).toBe(`eq.${TASK_ID}`);
    expect(evq.get("type")).toContain("task_created");
    // The note arm filtered on messages.task_id + direction note.
    const nq = notes.calls[0].url.searchParams;
    expect(nq.get("task_id")).toBe(`eq.${TASK_ID}`);
    expect(nq.get("direction")).toBe("eq.note");
  });

  it("404s an unknown task", async () => {
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), membersRoute(), detail.route);
    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// PATCH /v1/tasks/:id — metadata only, assign/due audit (T4, T2.1)
// --------------------------------------------------------------------------
describe("PATCH /v1/tasks/:id — metadata", () => {
  // T3: metadata rides two atomic RPCs — `update_task` (title/description/due,
  // its own task_due_set event) and `assign_task` (assignee, its task_assigned
  // event). The suite stubs both and lets each echo an outcome; the route maps
  // outcomes to §7 and returns the freshest row.
  interface PatchStubs {
    update: Stub;
    assign: Stub;
    all: FetchRoute[];
  }
  function patchStubs(
    options: {
      updateOutcome?: string;
      assignOutcome?: string;
      current?: Record<string, unknown>;
    } = {},
  ): PatchStubs {
    const current = options.current ?? {};
    const update = stubRoute(rpcMatch(env, "update_task"), (call) => {
      const p = call.body as Record<string, unknown>;
      const outcome = options.updateOutcome ?? "updated";
      if (outcome === "not_found") return { outcome, task: null };
      return {
        outcome,
        task: taskRow({
          ...current,
          ...(p.p_title != null ? { title: p.p_title } : {}),
          ...(p.p_clear_due ? { due_at: null } : {}),
          ...(p.p_due_at != null ? { due_at: p.p_due_at } : {}),
        }),
      };
    });
    const assign = stubRoute(rpcMatch(env, "assign_task"), (call) => {
      const p = call.body as Record<string, unknown>;
      const outcome = options.assignOutcome ?? "updated";
      if (outcome === "not_found" || outcome === "not_member") {
        return { outcome, task: null };
      }
      return {
        outcome,
        task: taskRow({ ...current, assigned_user_id: p.p_assigned_user_id }),
      };
    });
    return {
      update,
      assign,
      all: [jwksRoute(auth), membersRoute(), update.route, assign.route],
    };
  }

  it("assigning calls assign_task with the new assignee", async () => {
    const stubs = patchStubs({ current: { assigned_user_id: null } });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      assigned_user_id: OTHER_USER,
    });
    expect(response.status).toBe(200);
    // Only assign_task runs (no metadata fields) — it owns the task_assigned
    // event atomically; the route no longer writes events itself.
    expect(stubs.update.calls).toHaveLength(0);
    expect(stubs.assign.calls).toHaveLength(1);
    const p = stubs.assign.calls[0].body as Record<string, unknown>;
    expect(p).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_assigned_user_id: OTHER_USER,
      p_actor_user_id: auth.subject,
    });
    const body = (await response.json()) as { assigned_user_id: string };
    expect(body.assigned_user_id).toBe(OTHER_USER);
  });

  it("setting due_at calls update_task with the concrete value (no clear)", async () => {
    const stubs = patchStubs({ current: { due_at: null } });
    stubFetch(...stubs.all);
    const due = "2026-07-10T17:00:00.000Z";
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      due_at: due,
    });
    expect(response.status).toBe(200);
    expect(stubs.assign.calls).toHaveLength(0);
    expect(stubs.update.calls).toHaveLength(1);
    const p = stubs.update.calls[0].body as Record<string, unknown>;
    expect(p).toMatchObject({
      p_task_id: TASK_ID,
      p_due_at: due,
      p_clear_due: false,
      p_actor_user_id: auth.subject,
    });
  });

  it("clearing due_at sends p_clear_due=true (null value is distinguishable)", async () => {
    const stubs = patchStubs({ current: { due_at: "2026-07-10T17:00:00.000Z" } });
    stubFetch(...stubs.all);
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { due_at: null });
    const p = stubs.update.calls[0].body as Record<string, unknown>;
    expect(p).toMatchObject({ p_due_at: null, p_clear_due: true });
  });

  it("a combined assignee + due patch runs BOTH atomic RPCs", async () => {
    const stubs = patchStubs({ current: { assigned_user_id: null, due_at: null } });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      assigned_user_id: OTHER_USER,
      due_at: "2026-07-10T17:00:00.000Z",
    });
    expect(response.status).toBe(200);
    expect(stubs.update.calls).toHaveLength(1);
    expect(stubs.assign.calls).toHaveLength(1);
    // The freshest row (assign_task ran last) carries the assignee.
    const body = (await response.json()) as { assigned_user_id: string };
    expect(body.assigned_user_id).toBe(OTHER_USER);
  });

  it("rejects a `done` field — completion is the message route, not here", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      done: true,
    });
    expect(response.status).toBe(422);
  });

  it("422 when the assignee is not an active member (assign_task not_member)", async () => {
    const stubs = patchStubs({ assignOutcome: "not_member" });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      assigned_user_id: OTHER_USER,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("a no-op metadata patch is idempotent (update_task 'unchanged'), returns the row", async () => {
    const stubs = patchStubs({
      updateOutcome: "unchanged",
      current: { title: "Fix the leak" },
    });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      title: "Fix the leak",
    });
    expect(response.status).toBe(200);
    // The RPC still runs (it is the atomic no-op guard), but returns the row.
    expect(stubs.update.calls).toHaveLength(1);
    const body = (await response.json()) as { id: string };
    expect(body.id).toBe(TASK_ID);
  });

  it("404s an unknown task (update_task not_found)", async () => {
    const stubs = patchStubs({ updateOutcome: "not_found" });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      title: "x",
    });
    expect(response.status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// DELETE /v1/tasks/:id — soft-delete + role gate (T4, M*)
// --------------------------------------------------------------------------
describe("DELETE /v1/tasks/:id — soft-delete + role gate", () => {
  // T3: DELETE reads the task for the creator-or-owner/admin auth gate (that
  // check stays in the Worker), then calls the `delete_task` security-definer
  // RPC — ONE atomic transaction that soft-deletes the task AND its generic
  // attachments AND writes the task_deleted event, so an orphaned attachment
  // can never leak into the gallery. The suite stubs the auth-gate read + the
  // RPC.
  function deleteStubs(options: {
    createdBy?: string;
    role?: "member" | "admin" | "owner";
    outcome?: string;
  } = {}) {
    const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ created_by_user_id: options.createdBy ?? auth.subject }),
    ]);
    const del = stubRoute(rpcMatch(env, "delete_task"), () => ({
      outcome: options.outcome ?? "deleted",
    }));
    return {
      lookup,
      del,
      all: [
        jwksRoute(auth),
        membersRoute(options.role),
        lookup.route,
        del.route,
      ],
    };
  }

  it("the creator can soft-delete: 204 via delete_task (atomic)", async () => {
    const stubs = deleteStubs({ createdBy: auth.subject });
    stubFetch(...stubs.all);
    const response = await request(
      "DELETE",
      `/v1/tasks/${TASK_ID}`,
      undefined,
      memberApp,
    );
    expect(response.status).toBe(204);
    // The atomic RPC ran once with the task + actor; the route writes nothing
    // else (the RPC owns the task + attachment soft-deletes + the event).
    expect(stubs.del.calls).toHaveLength(1);
    expect(stubs.del.calls[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_actor_user_id: auth.subject,
    });
  });

  it("a non-creator member is forbidden (403)", async () => {
    const stubs = deleteStubs({ createdBy: OTHER_USER, role: "member" });
    stubFetch(...stubs.all);
    const response = await request(
      "DELETE",
      `/v1/tasks/${TASK_ID}`,
      undefined,
      memberApp,
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
    // The gate fires before the RPC — no write.
    expect(stubs.del.calls).toHaveLength(0);
  });

  it("an admin can delete a task created by someone else", async () => {
    const stubs = deleteStubs({ createdBy: OTHER_USER, role: "admin" });
    stubFetch(...stubs.all);
    const response = await request(
      "DELETE",
      `/v1/tasks/${TASK_ID}`,
      undefined,
      memberApp,
    );
    expect(response.status).toBe(204);
    expect(stubs.del.calls).toHaveLength(1);
  });

  it("404s when delete_task reports the task already gone (lost race)", async () => {
    const stubs = deleteStubs({ createdBy: auth.subject, outcome: "not_found" });
    stubFetch(...stubs.all);
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(404);
  });

  it("404s an unknown task", async () => {
    const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), membersRoute(), lookup.route);
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(404);
  });
});
