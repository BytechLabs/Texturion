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
  authorizeRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { notifyTaskChangeSafely } from "../tasks/notify";
import { tasksRoutes } from "./tasks";

// The alerts have their own suite (tasks/notify.test.ts). Here they are only
// asked "was it raised, for whom, by whom": the route's half of the contract.
vi.mock("../tasks/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/notify")>()),
  notifyTaskChangeSafely: vi.fn(async () => undefined),
}));

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const CALL_ID = "aaaaaaaa-0000-4000-8000-0000000000c1";
const TASK_ID = "77777777-0000-4000-8000-000000000077";
const CONTACT_ID = "c0cccccc-0000-4000-8000-0000000000c0";
const OTHER_USER = "22222222-0000-4000-8000-000000000022";
const NOTE_ID = "dddddddd-0000-4000-8000-0000000000d1";
const NOTE_AUTHOR = "77770000-0000-4000-8000-000000000777";
const MMS_ATT_ID = "eeeeeeee-1111-4000-8000-0000000000a1";
const NOTE_ATT_ID = "eeeeeeee-2222-4000-8000-0000000000a2";
const LEGACY_ATT_ID = "eeeeeeee-3333-4000-8000-0000000000a3";

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
 * The company-context MIDDLEWARE's own probe (#236: membership and session in
 * one RPC). Route-level company_members queries — the assignee-membership
 * check, for instance — are a different endpoint entirely and still fall
 * through to their own stubs.
 */
function membersRoute(role: "member" | "admin" | "owner" = "member"): FetchRoute {
  return authorizeRoute(env, {
    id: "11111111-0000-4000-8000-000000000011",
    role,
  });
}

/**
 * #106/#107: the create/detail/checklist routes resolve the caller's number
 * access. `[]` = no rules → unrestricted, so the guards short-circuit and the
 * existing assertions are unchanged. Tests that exercise a hidden number stub
 * this route with a rule and a conversations lookup explicitly.
 */
/**
 * #237: the reads a task write's reminder sync makes.
 *
 * Registered on every task-route stub set rather than per test, because the
 * sync runs after EVERY write — that is the point of it, and a harness that
 * only knows about it in the due-date tests would leave the others issuing
 * unmatched fetches that outlive their assertions.
 *
 * Empty rules is the honest default: most workspaces have never opened the
 * setting, so the sync's real job here is to clear, which is what an empty
 * array asks the RPC to do.
 */
function reminderRoutes(): FetchRoute[] {
  return [
    // Registered LAST by every caller, so a describe that already stubs the
    // task lookup keeps its own answer; this only catches the sets that do not
    // read tasks at all (creation), where an unmatched fetch simply hangs.
    stubRoute(
      (url) => url.pathname.endsWith("/rest/v1/tasks"),
      () => [],
    ).route,
    stubRoute(
      (url) => url.pathname.endsWith("/rest/v1/appointment_reminder_rules"),
      () => [],
    ).route,
    stubRoute(
      (url) => url.pathname.endsWith("/rest/v1/rpc/api_sync_task_reminders"),
      () => ({ outcome: "synced", removed: 0, added: 0 }),
    ).route,
  ];
}

function numberAccessRoute(rules: unknown[] = []): FetchRoute {
  return stubRoute(rpcMatch(env, "member_number_levels"), () => rules).route;
}

/**
 * #689 D: the detail route reads whether the caller follows the task. `null`
 * is a task they never followed; pass a row to say otherwise.
 */
function subscriptionRoute(
  row: { unsubscribed_at: string | null } | null = null,
): FetchRoute {
  return stubRoute(restMatch(env, "GET", "task_subscribers"), () =>
    row ? [row] : [],
  ).route;
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
    new Request(`https://api.loonext.com${path}`, {
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
    return {
      rpc,
      all: [
        jwksRoute(auth),
        membersRoute(),
        numberAccessRoute(),
        rpc.route,
        ...reminderRoutes(),
      ],
    };
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

  it("422 when there is neither a source nor a title", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks", { description: "orphan" });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("422 when a contact or conversation link rides on a promotion", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
      contact_id: OTHER_USER,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  describe("standalone (#689)", () => {
    const HIDDEN_NUM = "f0000000-0000-4000-8000-0000000000f2";
    const hidingRule = { phone_number_id: HIDDEN_NUM, level: "none" };
    const standalone = () =>
      taskRow({
        message_id: null,
        conversation_id: null,
        contact_id: null,
        title: "Order a furnace filter",
        assigned_user_id: auth.subject,
      });

    it("creates a task from a title alone: no source, assignee defaults to the creator, source null", async () => {
      const stubs = createStubs({ task: standalone() });
      stubFetch(...stubs.all);

      const response = await request("POST", "/v1/tasks", {
        title: "Order a furnace filter",
      });
      expect(response.status).toBe(201);
      expect(stubs.rpc.calls[0].body).toMatchObject({
        p_company_id: COMPANY_ID,
        p_message_id: null,
        p_call_id: null,
        p_title: "Order a furnace filter",
        p_assigned_user_id: auth.subject,
        p_contact_id: null,
        p_conversation_id: null,
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ message_id: null, source: null });
    });

    it("an explicit null assignee leaves the task unassigned", async () => {
      const stubs = createStubs({ task: standalone() });
      stubFetch(...stubs.all);
      await request("POST", "/v1/tasks", { title: "Floating", assigned_user_id: null });
      expect(
        (stubs.rpc.calls[0].body as Record<string, unknown>).p_assigned_user_id,
      ).toBeNull();
    });

    it("a promotion keeps its assignee default of nobody", async () => {
      const stubs = createStubs();
      stubFetch(...stubs.all);
      await request("POST", "/v1/tasks", { message_id: MESSAGE_ID });
      expect(
        (stubs.rpc.calls[0].body as Record<string, unknown>).p_assigned_user_id,
      ).toBeNull();
    });

    it("forwards the optional contact and conversation links", async () => {
      const stubs = createStubs({ task: standalone() });
      stubFetch(...stubs.all);
      await request("POST", "/v1/tasks", {
        title: "Call back about the quote",
        contact_id: OTHER_USER,
        due_at: "2026-12-01T15:00:00.000Z",
      });
      expect(stubs.rpc.calls[0].body).toMatchObject({
        p_contact_id: OTHER_USER,
        p_conversation_id: null,
        p_due_at: "2026-12-01T15:00:00.000Z",
      });
    });

    it.each([
      ["title_required"],
      ["no_conversation"],
      ["no_contact"],
      ["contact_mismatch"],
      ["bad_link"],
    ])("maps the standalone outcome %s to 422", async (outcome) => {
      const stubs = createStubs({ outcome });
      stubFetch(...stubs.all);
      const response = await request("POST", "/v1/tasks", { title: "x" });
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe("validation_failed");
    });

    it("a standalone task linked to a hidden conversation is refused like that conversation's own", async () => {
      const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
        { phone_number_id: HIDDEN_NUM },
      ]);
      const rpc = stubRoute(rpcMatch(env, "create_task"), () => ({
        outcome: "created",
        task: standalone(),
      }));
      stubFetch(
        jwksRoute(auth),
        membersRoute(),
        numberAccessRoute([hidingRule]),
        conv.route,
        rpc.route,
        ...reminderRoutes(),
      );
      const response = await request("POST", "/v1/tasks", {
        title: "Follow up",
        conversation_id: CONVERSATION_ID,
      });
      expect(response.status).toBe(404);
      expect(rpc.calls).toHaveLength(0);
    });

    it("a standalone task with no conversation needs no number access", async () => {
      const rpc = stubRoute(rpcMatch(env, "create_task"), () => ({
        outcome: "created",
        task: standalone(),
      }));
      stubFetch(
        jwksRoute(auth),
        membersRoute(),
        numberAccessRoute([hidingRule]),
        rpc.route,
        ...reminderRoutes(),
      );
      const response = await request("POST", "/v1/tasks", { title: "Buy parts" });
      expect(response.status).toBe(201);
      expect(rpc.calls).toHaveLength(1);
    });
  });

  it("422 when both a message and a call are given", async () => {
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
      source_call_id: CALL_ID,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
  });

  it("promotes an answered call via create_task: p_call_id, no message, source=call", async () => {
    const stubs = createStubs({
      task: taskRow({
        message_id: null,
        source_call_id: CALL_ID,
        title: "Call from Pat Plumber",
      }),
    });
    stubFetch(...stubs.all);

    const response = await request("POST", "/v1/tasks", {
      source_call_id: CALL_ID,
      title: "Call from Pat Plumber",
    });
    expect(response.status).toBe(201);
    const params = stubs.rpc.calls[0].body as Record<string, unknown>;
    expect(params).toMatchObject({
      p_company_id: COMPANY_ID,
      p_message_id: null,
      p_call_id: CALL_ID,
      p_title: "Call from Pat Plumber",
      p_actor_user_id: auth.subject,
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      message_id: null,
      source_call_id: CALL_ID,
      source: { kind: "call", id: CALL_ID },
    });
  });

  it.each([
    ["call_not_answered", 422, "validation_failed"],
    ["call_no_conversation", 422, "validation_failed"],
    ["no_call", 422, "validation_failed"],
    ["conflict", 409, "conflict"],
  ])("maps the call outcome %s to %i", async (outcome, status, code) => {
    const stubs = createStubs({ outcome });
    stubFetch(...stubs.all);
    const response = await request("POST", "/v1/tasks", {
      source_call_id: CALL_ID,
    });
    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
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

  // The has_location (Map) path reads the flat task_map_rows view (#221), not
  // the tasks table.
  function mapStub(rows: Record<string, unknown>[]): Stub {
    return stubRoute(restMatch(env, "GET", "task_map_rows"), () => rows);
  }

  it("rejects malformed filter params with 422 before touching the DB", async () => {
    for (const q of [
      "conversation_id=not-a-uuid",
      "assigned_user_id=nope",
      "due_before=today",
      "due_after=2026-13-40",
    ]) {
      const list = listStub([]);
      stubFetch(jwksRoute(auth), membersRoute(), list.route);
      const response = await request("GET", `/v1/tasks?${q}`);
      expect(response.status).toBe(422);
      expect(list.calls).toHaveLength(0); // never reached PostgREST
    }
  });

  it("defaults to Open·Mine (status=open, assignee=me) with no params", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);

    const response = await request("GET", "/v1/tasks");
    expect(response.status).toBe(200);

    const q = list.calls[0].url.searchParams;
    // status=open → the effective done state is null; assignee=me → the caller's sub.
    expect(q.get("task_done_at")).toBe("is.null");
    expect(q.get("assigned_user_id")).toBe(`eq.${auth.subject}`);
    // Company-scoped, live rows only.
    expect(q.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(q.get("deleted_at")).toBe("is.null");
    // The computed column drives the derived status (D64): an inner embed of
    // the source message would drop every call-anchored task. The call a task
    // promotes rides along as a left embed on the one FK between the tables.
    expect(q.get("select")).toContain("done_state:task_done_at");
    expect(q.get("select")).not.toContain("messages");
    expect(q.get("select")).toContain("source_call:calls!source_call_id(");
    expect(q.get("select")).toContain("source_call_id");
    // D137: provider-removal/refusal attention rows are a hold, not ordinary
    // undated work. The empty calendar_hold embed is an anti-join over the
    // composite tenant/task FK. A conflict is deliberately absent: it remains
    // a dated task while the member chooses which schedule wins.
    expect(q.get("select")).toContain(
      "calendar_hold:task_calendar_links!task_calendar_links_company_id_task_id_fkey()",
    );
    expect(q.get("calendar_hold.company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(q.get("calendar_hold.link_state")).toBe(
      "in.(event_removed,refused)",
    );
    expect(q.get("calendar_hold.link_state")).not.toContain("conflict");
    expect(q.get("calendar_hold")).toBe("is.null");
  });

  it("derives done from the task_done_at computed column", async () => {
    const list = listStub([
      taskRow({
        id: TASK_ID,
        done_state: null,
        calendar_hold: [],
      }),
      taskRow({
        id: "77777777-0000-4000-8000-000000000078",
        done_state: "2026-07-02T14:00:00.000Z",
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
    expect(body.data[0]).not.toHaveProperty("done_state");
    expect(body.data[0]).not.toHaveProperty("calendar_hold");
  });

  it("lists a call-anchored task with its source and the call", async () => {
    const CALL_ID = "77777777-0000-4000-8000-0000000000ca";
    const list = listStub([
      taskRow({
        id: "77777777-0000-4000-8000-0000000000c9",
        message_id: null,
        source_call_id: CALL_ID,
        done_state: "2026-07-02T14:00:00.000Z",
        source_call: {
          id: CALL_ID,
          call_session_id: "sess-1",
          caller_e164: "+14155550100",
          caller_name: "Pat Plumber",
          outcome: "answered",
          forward_seconds: 180,
          started_at: "2026-07-02T13:00:00.000Z",
          ended_at: "2026-07-02T13:03:00.000Z",
          contact_id: null,
          voicemail_path: "secret/path.wav",
        },
      }),
      taskRow({ id: TASK_ID, done_state: null }),
    ]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);

    const response = await request("GET", "/v1/tasks?status=done");
    const body = (await response.json()) as {
      data: Record<string, unknown>[];
    };
    expect(body.data[0]).toMatchObject({
      message_id: null,
      done: true,
      status: "done",
      source: { kind: "call", id: CALL_ID },
      call: { caller_name: "Pat Plumber", has_voicemail: true },
    });
    // The storage path never leaves the server.
    expect(JSON.stringify(body.data[0])).not.toContain("secret/path.wav");
    expect(body.data[1]).toMatchObject({
      source: { kind: "message", id: MESSAGE_ID },
      call: null,
    });
  });

  it("status=done filters the join with done_at not-null", async () => {
    const list = listStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), list.route);
    await request("GET", "/v1/tasks?status=done");
    expect(list.calls[0].url.searchParams.get("task_done_at")).toBe(
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
    expect(q.get("task_done_at")).toBe("is.null");
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

  it("has_location=true reads the map view and filters on the coalesced location (#221)", async () => {
    const list = mapStub([]);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), list.route);
    await request("GET", "/v1/tasks?has_location=true");
    const q = list.calls[0].url.searchParams;
    // Flat view columns, not a nested embed.
    expect(q.get("select")).toContain("contact_lat");
    expect(q.get("select")).not.toContain("contacts!inner");
    // THE #221 fix: map_lat = coalesce(task.lat, contact.lat) — a task with its
    // OWN geocode but a non-geocoded contact now qualifies.
    expect(q.get("map_lat")).toBe("not.is.null");
    // The map is another ordinary task-list projection and observes the same
    // D137 hold; otherwise an all-day/refused task could still appear as a pin.
    expect(q.get("calendar_hold.company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(q.get("calendar_hold.link_state")).toBe(
      "in.(event_removed,refused)",
    );
    expect(q.get("calendar_hold")).toBe("is.null");
    // Unrestricted caller → no hidden-number exclusion on the map view.
    expect(q.get("phone_number_id")).toBeNull();
  });

  it("#106/#107: the map view excludes tasks on numbers hidden from the caller", async () => {
    // The map projects the source contact's name + geocode (conversation
    // content), so a restricted member must not see hidden-number pins. The
    // exclusion is a flat view-column filter (keeps the keyset window correct).
    const HIDDEN_NUM = "f0000000-0000-4000-8000-0000000000f1";
    const list = mapStub([]);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([
        { phone_number_id: HIDDEN_NUM, level: "none" },
      ]),
      list.route,
    );
    await request("GET", "/v1/tasks?has_location=true");
    const q = list.calls[0].url.searchParams;
    // A standalone task with no conversation has no number (#689): the filter
    // must keep it, which a bare `not.in` would not.
    expect(q.get("or")).toBe(
      `(phone_number_id.is.null,phone_number_id.not.in.(${HIDDEN_NUM}))`,
    );
  });

  it("has_location projects the flat view row → done + contact, stripping view-only columns (#221)", async () => {
    // A task with its OWN geocode but a contact WITHOUT one — the case #221
    // makes visible. The view row carries flat done_at + contact_* columns.
    const list = mapStub([
      {
        id: TASK_ID,
        company_id: COMPANY_ID,
        message_id: MESSAGE_ID,
        conversation_id: CONVERSATION_ID,
        title: "Paint the CN Tower",
        due_at: null,
        created_at: "2026-07-24T00:00:00.000Z",
        updated_at: "2026-07-24T00:00:00.000Z",
        lat: 43.6426,
        lng: -79.3871,
        done_at: null,
        contact_id: CONTACT_ID,
        contact_name: "Acme Co",
        contact_lat: null,
        contact_lng: null,
      },
    ]);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), list.route);
    const response = await request("GET", "/v1/tasks?has_location=true");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Record<string, unknown>[];
    };
    const row = body.data[0];
    // Derived + projected fields.
    expect(row.done).toBe(false);
    expect(row.status).toBe("open");
    expect(row.lat).toBe(43.6426); // the task's own geocode reaches the client
    expect(row.contact).toEqual({
      id: CONTACT_ID,
      name: "Acme Co",
      lat: null, // contact NOT geocoded — the pin comes from the task's own lat
      lng: null,
    });
    // View-only columns never leak into the task contract.
    for (const leak of [
      "done_at",
      "contact_id",
      "contact_name",
      "contact_lat",
      "contact_lng",
      "map_lat",
      "phone_number_id",
      "calendar_hold",
    ]) {
      expect(row).not.toHaveProperty(leak);
    }
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
// --------------------------------------------------------------------------
// The D28 derived-attachments union stubs, shared by the checklist and detail
// suites. Three arms: source-message MMS, linked-note generic files, legacy
// owner_type='task' rows.
// --------------------------------------------------------------------------
function unionStubs() {
  const mms = stubRoute(restMatch(env, "GET", "message_attachments"), () => [
    {
      id: MMS_ATT_ID,
      message_id: MESSAGE_ID,
      content_type: "image/jpeg",
      size_bytes: 4,
      created_at: "2026-07-02T12:05:00.000Z",
    },
  ]);
  // The note-LINK lookup (task_id=in.(...)) — distinct from the activity
  // notes arm (task_id=eq.<id>), so match on the `in.` filter shape.
  const noteLinks = stubRoute(
    restMatch(env, "GET", "messages", (url) =>
      (url.searchParams.get("task_id") ?? "").startsWith("in."),
    ),
    // #294: the note carries the label and the author its files inherit.
    () => [
      {
        id: NOTE_ID,
        task_id: TASK_ID,
        work_phase: "after",
        sent_by_user_id: NOTE_AUTHOR,
      },
    ],
  );
  const noteAttach = stubRoute(
    restMatch(
      env,
      "GET",
      "attachments",
      (url) => url.searchParams.get("owner_type") === "eq.note",
    ),
    () => [
      {
        id: NOTE_ATT_ID,
        owner_id: NOTE_ID,
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        created_at: "2026-07-02T14:00:00.000Z",
      },
    ],
  );
  const legacyAttach = stubRoute(
    restMatch(
      env,
      "GET",
      "attachments",
      (url) => url.searchParams.get("owner_type") === "eq.task",
    ),
    () => [
      {
        id: LEGACY_ATT_ID,
        owner_id: TASK_ID,
        file_name: "site.png",
        content_type: "image/png",
        size_bytes: 512,
        created_at: "2026-07-02T13:00:00.000Z",
      },
    ],
  );
  return { mms, noteLinks, noteAttach, legacyAttach };
}

describe("GET /v1/conversations/:id/tasks — checklist", () => {
  it("lists live tasks with derived done + the D28 union attachment_count, no cursor", async () => {
    const convCheck = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { id: CONVERSATION_ID },
    ]);
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ id: TASK_ID, messages: { id: MESSAGE_ID, done_at: null } }),
    ]);
    const union = unionStubs();
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute(),
      convCheck.route,
      list.route,
      union.mms.route,
      union.noteLinks.route,
      union.noteAttach.route,
      union.legacyAttach.route,
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
    // attachment_count = the DERIVED union (1 MMS + 1 note file + 1 legacy
    // task row = 3), NOT just owner_type='task' rows (D28).
    expect(body.data[0]).toMatchObject({
      id: TASK_ID,
      done: false,
      status: "open",
      attachment_count: 3,
    });
    // Checklist read is company-scoped + live-only, ordered created_at asc.
    const q = list.calls[0].url.searchParams;
    expect(q.get("conversation_id")).toBe(`eq.${CONVERSATION_ID}`);
    expect(q.get("deleted_at")).toBe("is.null");
    expect(q.get("order")).toContain("created_at.asc");
    // Both generic arms count LIVE rows only.
    expect(union.noteAttach.calls[0].url.searchParams.get("deleted_at")).toBe(
      "is.null",
    );
    expect(union.legacyAttach.calls[0].url.searchParams.get("deleted_at")).toBe(
      "is.null",
    );
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
    // D28 union arms, empty here (the union has its own dedicated test).
    const mmsAttach = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const noteLinks = stubRoute(
      restMatch(env, "GET", "messages", (url) =>
        (url.searchParams.get("task_id") ?? "").startsWith("in."),
      ),
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
      numberAccessRoute(),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      attachments.route,
      mmsAttach.route,
      noteLinks.route, // BEFORE notes: the `in.` link lookup must not hit the activity stub
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
    // task_attachment_removed IS filtered (the DELETE route now stamps task_id
    // on it); the never-written-post-D28 task_attachment_added is NOT.
    expect(evq.get("type")).toContain("task_attachment_removed");
    expect(evq.get("type")).not.toContain("task_attachment_added");
    // The note arm filtered on messages.task_id + direction note.
    const nq = notes.calls[0].url.searchParams;
    expect(nq.get("task_id")).toBe(`eq.${TASK_ID}`);
    expect(nq.get("direction")).toBe("eq.note");
  });

  it("a task linked to a deleted contact has no contact (#689)", async () => {
    const CONTACT_ID = "c0000000-0000-4000-8000-0000000000c9";
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        message_id: null,
        conversation_id: null,
        contact_id: CONTACT_ID,
        linked_contact: {
          id: CONTACT_ID,
          name: "Pat Plumber",
          deleted_at: "2026-11-01T00:00:00.000Z",
        },
        messages: null,
      }),
    ]);
    const empty = (table: string) => stubRoute(restMatch(env, "GET", table), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute(),
      subscriptionRoute(),
      detail.route,
      empty("profiles").route,
      empty("attachments").route,
      empty("message_attachments").route,
      empty("conversation_events").route,
      empty("messages").route,
    );
    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { contact: unknown }).contact).toBeNull();
  });

  it("a standalone task with no conversation: source null, linked contact, full access for a restricted member (#689)", async () => {
    const CONTACT_ID = "c0000000-0000-4000-8000-0000000000c9";
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        message_id: null,
        conversation_id: null,
        contact_id: CONTACT_ID,
        linked_contact: { id: CONTACT_ID, name: "Pat Plumber" },
        messages: null,
      }),
    ]);
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => []);
    const empty = (table: string) => stubRoute(restMatch(env, "GET", table), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      // This caller is denied a number; a task with no conversation has none.
      numberAccessRoute([
        { phone_number_id: "f0000000-0000-4000-8000-0000000000f1", level: "none" },
      ]),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      empty("attachments").route,
      empty("message_attachments").route,
      empty("conversation_events").route,
      empty("messages").route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      source: null,
      source_message: null,
      source_call: null,
      conversation_id: null,
      viewer_level: "text",
      contact: { id: CONTACT_ID, name: "Pat Plumber" },
    });
  });

  it("attachments is the D28 DERIVED union (source MMS + linked-note files + legacy rows), gallery-shaped, sorted, no urls", async () => {
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
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => [
      { user_id: auth.subject, display_name: "Sam" },
    ]);
    const union = unionStubs();
    const events = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    const activityNotes = stubRoute(restMatch(env, "GET", "messages"), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute(),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      union.mms.route,
      union.noteLinks.route, // BEFORE activityNotes (the `in.` link lookup)
      union.noteAttach.route,
      union.legacyAttach.route,
      events.route,
      activityNotes.route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attachments: Record<string, unknown>[];
    };
    // Three arms merged, (created_at, id) ASC: MMS 12:05 → legacy 13:00 →
    // note file 14:00. Gallery item shape, file_name null for carrier media,
    // and NO pre-signed url (the web mints one per item via /attachments/:id/url).
    expect(body.attachments).toEqual([
      {
        id: MMS_ATT_ID,
        source: "mms",
        kind: "image",
        file_name: null,
        content_type: "image/jpeg",
        size_bytes: 4,
        created_at: "2026-07-02T12:05:00.000Z",
        // #294: the customer's own photo. Not a visit, not a before, not ours.
        note_id: null,
        work_phase: null,
        added_by_user_id: null,
      },
      {
        id: LEGACY_ATT_ID,
        source: "task",
        kind: "image",
        file_name: "site.png",
        content_type: "image/png",
        size_bytes: 512,
        created_at: "2026-07-02T13:00:00.000Z",
        // A pre-D28 row has no note to inherit from. It predates the model
        // rather than being unlabelled within it.
        note_id: null,
        work_phase: null,
        added_by_user_id: null,
      },
      {
        id: NOTE_ATT_ID,
        source: "note",
        kind: "file",
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        created_at: "2026-07-02T14:00:00.000Z",
        // #294: inherited from the note, which is where the label lives.
        note_id: NOTE_ID,
        work_phase: "after",
        added_by_user_id: NOTE_AUTHOR,
      },
    ]);

    // Arm scoping: MMS by the SOURCE message, company-scoped; note files by
    // the linked notes' ids; legacy rows by the task id — all company-scoped.
    const mq = union.mms.calls[0].url.searchParams;
    expect(mq.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(mq.get("message_id")).toBe(`in.(${MESSAGE_ID})`);
    const lq = union.noteLinks.calls[0].url.searchParams;
    expect(lq.get("task_id")).toBe(`in.(${TASK_ID})`);
    expect(lq.get("direction")).toBe("eq.note");
    const naq = union.noteAttach.calls[0].url.searchParams;
    expect(naq.get("owner_id")).toBe(`in.(${NOTE_ID})`);
    const laq = union.legacyAttach.calls[0].url.searchParams;
    expect(laq.get("owner_id")).toBe(`in.(${TASK_ID})`);
  });

  it("#2: a note promoted to a task surfaces the source note's OWN files in the union", async () => {
    // Regression: promoting a note used to LOSE the note's files — create_task
    // set tasks.message_id but not the source note's messages.task_id, so
    // arm (b) (notes WHERE task_id = task) missed the promoted note itself. The
    // fixed create_task links it back, so the source note (here MESSAGE_ID, a
    // direction='note' row) appears in the note-link lookup and its file lands
    // in the derived union. Model exactly that: source note has one PDF; no MMS,
    // no legacy task rows.
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        messages: {
          id: MESSAGE_ID,
          body: "need to order the part",
          done_at: null,
          done_by_user_id: null,
          created_at: "2026-07-02T12:00:00.000Z",
          direction: "note",
        },
      }),
    ]);
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => [
      { user_id: auth.subject, display_name: "Sam" },
    ]);
    // Arm (a) MMS: none.
    const mms = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    // Arm (b) link lookup: the promoted note is linked back to the task.
    const noteLinks = stubRoute(
      restMatch(env, "GET", "messages", (url) =>
        (url.searchParams.get("task_id") ?? "").startsWith("in."),
      ),
    // #294: a promoted note with no label. Most notes are neither a before nor an
    // after, and this asserts the union says so rather than guessing.
    () => [
      {
        id: MESSAGE_ID,
        task_id: TASK_ID,
        work_phase: null,
        sent_by_user_id: NOTE_AUTHOR,
      },
    ],
    );
    // Arm (b) files: the source note's own generic attachment (the PDF).
    const noteAttach = stubRoute(
      restMatch(
        env,
        "GET",
        "attachments",
        (url) => url.searchParams.get("owner_type") === "eq.note",
      ),
      () => [
        {
          id: NOTE_ATT_ID,
          owner_id: MESSAGE_ID,
          file_name: "quote.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
          created_at: "2026-07-02T12:10:00.000Z",
        },
      ],
    );
    // Arm (c) legacy: none.
    const legacyAttach = stubRoute(
      restMatch(
        env,
        "GET",
        "attachments",
        (url) => url.searchParams.get("owner_type") === "eq.task",
      ),
      () => [],
    );
    const events = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    const activityNotes = stubRoute(restMatch(env, "GET", "messages"), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute(),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      mms.route,
      noteLinks.route,
      noteAttach.route,
      legacyAttach.route,
      events.route,
      activityNotes.route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attachments: { id: string; source: string; file_name: string }[];
    };
    // The promoted note's own file is present (source 'note').
    expect(body.attachments).toEqual([
      {
        id: NOTE_ATT_ID,
        source: "note",
        kind: "file",
        file_name: "quote.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        created_at: "2026-07-02T12:10:00.000Z",
        // #294: grouped and attributed even with no label, because those come
        // from the note existing rather than from anybody classifying it.
        note_id: MESSAGE_ID,
        work_phase: null,
        added_by_user_id: NOTE_AUTHOR,
      },
    ]);
    // The link lookup ran with the task id, and note files were fetched for the
    // linked (source) note.
    expect(noteLinks.calls[0].url.searchParams.get("task_id")).toBe(
      `in.(${TASK_ID})`,
    );
    expect(noteAttach.calls[0].url.searchParams.get("owner_id")).toBe(
      `in.(${MESSAGE_ID})`,
    );
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
      /** Whether the ASSIGNEE is an active member (default true). */
      assigneeActive?: boolean;
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
    // The assignee's own membership lookup, which now runs BEFORE any write
    // when a PATCH carries both metadata and an assignee.
    const assigneeRoute: FetchRoute = (url) =>
      url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/company_members`) &&
      url.searchParams.get("user_id") === `eq.${OTHER_USER}`
        ? Response.json(
            options.assigneeActive === false
              ? []
              : [{ user_id: OTHER_USER }],
          )
        : undefined;
    // #515: handing a job over now wakes its new owner, and outside a Worker
    // there is no execution context to defer that to — so the alert's own
    // lookups run inline here. Answering "the thread is gone" makes it a silent
    // no-op, which is what these tests want: they are about which RPC ran with
    // which arguments, and the alert has its own suite
    // (notifications/assignment.test.ts).
    const alertRoute: FetchRoute = (url) =>
      url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/conversations`) &&
      url.searchParams.get("select") === "phone_number_id"
        ? Response.json([])
        : undefined;
    return {
      update,
      assign,
      all: [
        jwksRoute(auth),
        membersRoute(),
        assigneeRoute,
        alertRoute,
        update.route,
        assign.route,
        ...reminderRoutes(),
      ],
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

  it("rejects `done` on a task that came from a text: completion is the message route", async () => {
    const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ message_id: MESSAGE_ID }),
    ]);
    const setDone = stubRoute(rpcMatch(env, "set_task_done"), () => ({}));
    stubFetch(jwksRoute(auth), membersRoute(), lookup.route, setDone.route);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      done: true,
    });
    expect(response.status).toBe(422);
    expect(setDone.calls).toHaveLength(0);
  });

  it("marks a call-anchored task done through set_task_done, and returns the source", async () => {
    const callTask = taskRow({ message_id: null, source_call_id: CALL_ID });
    const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => [callTask]);
    const setDone = stubRoute(rpcMatch(env, "set_task_done"), () => ({
      outcome: "updated",
      task: { ...callTask, done_at: "2026-07-02T15:00:00.000Z" },
    }));
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      lookup.route,
      setDone.route,
      ...reminderRoutes(),
    );
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      done: true,
    });
    expect(response.status).toBe(200);
    expect(setDone.calls[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_done: true,
      p_actor_user_id: auth.subject,
    });
    expect(await response.json()).toMatchObject({
      source: { kind: "call", id: CALL_ID },
    });
  });

  it("rejects an unassignable member without writing the metadata first", async () => {
    // The two RPCs are separate transactions, so a PATCH carrying both used to
    // commit the rename and THEN refuse the assignment, answering 422 for a
    // request that had already changed the task. The client restores its
    // previous cache on error, so the crew saw a title the caller believed had
    // been rejected, and an identical retry failed forever while the drift
    // stood.
    const stubs = patchStubs({ assigneeActive: false });
    stubFetch(...stubs.all);
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      title: "Replace water heater",
      assigned_user_id: OTHER_USER,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("validation_failed");
    // Nothing was written.
    expect(stubs.update.calls).toHaveLength(0);
    expect(stubs.assign.calls).toHaveLength(0);
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
        membersRoute(options.role ?? "admin"),
        lookup.route,
        del.route,
        ...reminderRoutes(),
      ],
    };
  }

  it("a holder of records.delete can soft-delete: 204 via delete_task (atomic)", async () => {
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

  it("a member is forbidden (403) even for a task they created (#691)", async () => {
    const stubs = deleteStubs({ createdBy: auth.subject, role: "member" });
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
    stubFetch(jwksRoute(auth), membersRoute("admin"), lookup.route);
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(404);
  });
});

// --------------------------------------------------------------------------
// #107: tasks stay GLOBAL, but the source conversation obeys #106 access.
// --------------------------------------------------------------------------
describe("POST /v1/tasks/bulk (#478)", () => {
  function rpcStub(result: Record<string, unknown>): Stub {
    return stubRoute(rpcMatch(env, "api_bulk_tasks"), () => result);
  }

  const ok = {
    action: "mark_done",
    matched: 2,
    applied: [
      { id: "11111111-1111-4111-8111-111111111111", previous: { done_at: null } },
    ],
    failed: [],
    capped: false,
  };

  it("bulk delete needs records.delete; the other actions do not (#691)", async () => {
    const rpc = rpcStub({ ...ok, action: "delete" });
    stubFetch(jwksRoute(auth), membersRoute("member"), numberAccessRoute(), rpc.route);
    const refused = await request("POST", "/v1/tasks/bulk", {
      action: "delete",
      ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(refused.status).toBe(403);
    expect(rpc.calls).toHaveLength(0);

    const allowed = await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(allowed.status).toBe(200);
  });

  it("an admin can bulk delete (#691)", async () => {
    const rpc = rpcStub({ ...ok, action: "delete" });
    stubFetch(jwksRoute(auth), membersRoute("admin"), numberAccessRoute(), rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "delete",
      ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(response.status).toBe(200);
    expect(rpc.calls).toHaveLength(1);
  });

  it("hands explicit ids straight to the RPC", async () => {
    const rpc = rpcStub(ok);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(response.status).toBe(200);
    expect(rpc.calls).toHaveLength(1);
  });

  it("resolves a filter with the LIST's query, not a second one", async () => {
    // The whole design. "Mark everything matching this filter done" has to mean
    // exactly what the list showed, and the only way to guarantee that is for
    // both to run the same builder — so the filter mode reads `tasks` with the
    // same predicates rather than passing them to SQL.
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      { id: "11111111-1111-4111-8111-111111111111" },
    ]);
    const rpc = rpcStub(ok);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), list.route, rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      filter: { status: "open", overdue: true },
    });
    expect(response.status).toBe(200);
    expect(list.calls).toHaveLength(1);
    const url = list.calls[0].url;
    // The status filter lands on the effective done state (T2/D64: there is no
    // task status column), and overdue adds the past-due bound.
    expect(url.searchParams.get("task_done_at")).toBe("is.null");
    expect(url.searchParams.get("due_at")).toContain("lt.");
    // Select-all must not reach the attention-held rows the list hid.
    expect(url.searchParams.get("calendar_hold.company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    expect(url.searchParams.get("calendar_hold.link_state")).toBe(
      "in.(event_removed,refused)",
    );
    expect(url.searchParams.get("calendar_hold")).toBe("is.null");
  });

  it("answers an empty filter match without calling the RPC", async () => {
    // A selection that matched nothing is a legitimate outcome, not a malformed
    // request — and the RPC requires a non-empty id list.
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    const rpc = rpcStub(ok);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), list.route, rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      filter: { status: "open" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ matched: 0, applied: [] });
    expect(rpc.calls).toHaveLength(0);
  });

  it("refuses a request with neither ids nor filter", async () => {
    // Neither means "every task in the company", which no UI should be able to
    // ask for by omitting a field.
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks/bulk", { action: "mark_done" });
    expect(response.status).toBe(422);
  });

  it("refuses an unassign-everything-matching-a-filter", async () => {
    // `assign` with no target means UNASSIGN, which is legitimate — but not as
    // something a UI can fire by leaving a field out.
    stubFetch(jwksRoute(auth), membersRoute());
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "assign",
      filter: { status: "open" },
    });
    expect(response.status).toBe(422);
  });

  it("has no send action, and cannot be given one", async () => {
    // The rule #275 established, inherited by every new bulk surface: the zod
    // enum here is the second of two gates, the SQL enum is the first.
    stubFetch(jwksRoute(auth), membersRoute());
    for (const action of ["send", "reply", "message"]) {
      const response = await request("POST", "/v1/tasks/bulk", {
        action,
        ids: ["11111111-1111-4111-8111-111111111111"],
      });
      expect(response.status, action).toBe(422);
    }
  });

  it("passes the caller's hidden numbers to the RPC", async () => {
    // #106: the access intersection happens in SQL, but the route has to hand
    // over what the caller may not see — passing null would apply the action to
    // tasks on denied numbers.
    const rpc = rpcStub(ok);
    stubFetch(jwksRoute(auth), membersRoute(), numberAccessRoute(), rpc.route);
    await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(rpc.calls[0].body).toHaveProperty("p_hidden_number_ids");
  });
});

describe("#106/#107 number access on tasks", () => {
  const HIDDEN_NUM = "f0000000-0000-4000-8000-0000000000f1";
  const VIS_NUM = "f0000000-0000-4000-8000-0000000000f2";

  /** An admins-only rule the default 'member' caller can never match → none. */
  const hidingRule = { phone_number_id: HIDDEN_NUM, level: "none" };
  /** The caller resolved to note level on the visible number. */
  const noteRule = () => ({ phone_number_id: VIS_NUM, level: "note" });

  it("detail: a hidden number redacts conversation content but keeps the task identity", async () => {
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        title: "Follow up",
        messages: {
          id: MESSAGE_ID,
          body: "SECRET customer message",
          done_at: null,
          done_by_user_id: null,
          created_at: "2026-07-02T12:00:00.000Z",
          direction: "inbound",
        },
      }),
    ]);
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => []);
    const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { phone_number_id: HIDDEN_NUM },
    ]);
    // Attachment/activity stubs are present but MUST NOT be hit (short-circuit).
    const attach = stubRoute(restMatch(env, "GET", "attachments"), () => []);
    const events = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([hidingRule]),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      conv.route,
      attach.route,
      events.route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      viewer_level: string;
      source_message: unknown;
      attachments: unknown[];
      activity: unknown[];
    };
    // Identity survives (global task); conversation content is withheld.
    expect(body).toMatchObject({
      id: TASK_ID,
      title: "Follow up",
      viewer_level: "none",
      source_message: null,
    });
    expect(body.attachments).toEqual([]);
    expect(body.activity).toEqual([]);
    // The redaction short-circuits BEFORE the attachment/activity loads.
    expect(attach.calls).toHaveLength(0);
    expect(events.calls).toHaveLength(0);
  });

  it("detail: a note-level viewer sees content with viewer_level 'note'", async () => {
    const detail = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        messages: {
          id: MESSAGE_ID,
          body: "hi",
          done_at: null,
          done_by_user_id: null,
          created_at: "2026-07-02T12:00:00.000Z",
          direction: "inbound",
        },
      }),
    ]);
    const profiles = stubRoute(restMatch(env, "GET", "profiles"), () => []);
    const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { phone_number_id: VIS_NUM },
    ]);
    const attach = stubRoute(restMatch(env, "GET", "attachments"), () => []);
    const mms = stubRoute(
      restMatch(env, "GET", "message_attachments"),
      () => [],
    );
    const noteLinks = stubRoute(
      restMatch(env, "GET", "messages", (url) =>
        (url.searchParams.get("task_id") ?? "").startsWith("in."),
      ),
      () => [],
    );
    const events = stubRoute(
      restMatch(env, "GET", "conversation_events"),
      () => [],
    );
    const notes = stubRoute(restMatch(env, "GET", "messages"), () => []);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([noteRule()]),
      subscriptionRoute(),
      detail.route,
      profiles.route,
      conv.route,
      attach.route,
      mms.route,
      noteLinks.route,
      events.route,
      notes.route,
    );

    const response = await request("GET", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      viewer_level: string;
      source_message: { id: string } | null;
    };
    expect(body.viewer_level).toBe("note");
    expect(body.source_message).toMatchObject({ id: MESSAGE_ID });
  });

  it("checklist: 404s when the number is hidden from the caller", async () => {
    // Existence check + access lookup both read conversations; one row serves both.
    const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { id: CONVERSATION_ID, phone_number_id: HIDDEN_NUM },
    ]);
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([hidingRule]),
      conv.route,
    );
    const response = await request(
      "GET",
      `/v1/conversations/${CONVERSATION_ID}/tasks`,
    );
    expect(response.status).toBe(404);
  });

  it("create: 404s promoting a message on a hidden number; the RPC is never called", async () => {
    const source = stubRoute(restMatch(env, "GET", "messages"), () => [
      { conversation_id: CONVERSATION_ID },
    ]);
    const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { phone_number_id: HIDDEN_NUM },
    ]);
    const rpc = stubRoute(rpcMatch(env, "create_task"), () => ({
      outcome: "created",
      task: taskRow(),
    }));
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([hidingRule]),
      source.route,
      conv.route,
      rpc.route,
      ...reminderRoutes(),
    );

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
    });
    expect(response.status).toBe(404);
    expect(rpc.calls).toHaveLength(0);
  });

  it("create: a note-level member CAN promote a message (internal coordination)", async () => {
    const source = stubRoute(restMatch(env, "GET", "messages"), () => [
      { conversation_id: CONVERSATION_ID },
    ]);
    const conv = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { phone_number_id: VIS_NUM },
    ]);
    const rpc = stubRoute(rpcMatch(env, "create_task"), () => ({
      outcome: "created",
      task: taskRow({ title: "noted" }),
    }));
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      numberAccessRoute([noteRule()]),
      source.route,
      conv.route,
      rpc.route,
      ...reminderRoutes(),
    );

    const response = await request("POST", "/v1/tasks", {
      message_id: MESSAGE_ID,
    });
    expect(response.status).toBe(201);
    expect(rpc.calls).toHaveLength(1);
  });
});

describe("#689 D subscriber alerts raised by the task routes", () => {
  const alerts = vi.mocked(notifyTaskChangeSafely);

  // The new owner's own #515 alert runs inline outside a Worker; answering
  // "the thread is gone" makes it a silent no-op.
  const quietAssignmentAlert: FetchRoute = (url) =>
    url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/conversations`) &&
    url.searchParams.get("select") === "phone_number_id"
      ? Response.json([])
      : undefined;

  function world(options: {
    before: Record<string, unknown>;
    update?: (p: Record<string, unknown>) => Record<string, unknown>;
    doneOutcome?: string;
  }) {
    const prior = taskRow({ message_id: null, ...options.before });
    const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => [prior]);
    const update = stubRoute(rpcMatch(env, "update_task"), (call) => ({
      outcome: "updated",
      task: { ...prior, ...(options.update?.(call.body as Record<string, unknown>) ?? {}) },
    }));
    const assign = stubRoute(rpcMatch(env, "assign_task"), (call) => ({
      outcome: "updated",
      task: {
        ...prior,
        assigned_user_id: (call.body as Record<string, unknown>).p_assigned_user_id,
      },
    }));
    const setDone = stubRoute(rpcMatch(env, "set_task_done"), () => ({
      outcome: options.doneOutcome ?? "updated",
      task: prior,
    }));
    stubFetch(
      jwksRoute(auth),
      membersRoute(),
      quietAssignmentAlert,
      lookup.route,
      update.route,
      assign.route,
      setDone.route,
      ...reminderRoutes(),
    );
  }

  afterEach(() => {
    alerts.mockClear();
  });

  it("taking somebody off a task tells them, naming the person who did it", async () => {
    world({ before: { assigned_user_id: OTHER_USER } });
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      assigned_user_id: null,
    });
    expect(response.status).toBe(200);
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][1]).toMatchObject({
      companyId: COMPANY_ID,
      taskId: TASK_ID,
      actorUserId: auth.subject,
      kind: "unassigned",
      previousAssigneeId: OTHER_USER,
    });
  });

  it("giving a task to someone else tells the one who held it", async () => {
    world({ before: { assigned_user_id: OTHER_USER } });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      assigned_user_id: NOTE_AUTHOR,
    });
    expect(alerts.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ kind: "unassigned", previousAssigneeId: OTHER_USER }),
    ]);
  });

  it("assigning an unassigned task raises no unassigned alert", async () => {
    world({ before: { assigned_user_id: null } });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { assigned_user_id: OTHER_USER });
    expect(alerts).not.toHaveBeenCalled();
  });

  it("changing the due time raises due_changed; changing only the title does not", async () => {
    world({
      before: { due_at: "2026-07-10T17:00:00.000Z" },
      update: (p) => (p.p_due_at != null ? { due_at: p.p_due_at } : {}),
    });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { due_at: "2026-07-11T17:00:00.000Z" });
    expect(alerts.mock.calls.map((c) => c[1].kind)).toEqual(["due_changed"]);

    alerts.mockClear();
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { title: "New title" });
    expect(alerts).not.toHaveBeenCalled();
  });

  it("re-sending the same due time is not a change", async () => {
    world({
      before: { due_at: "2026-07-10T17:00:00.000Z" },
      update: (p) => ({ due_at: p.p_due_at }),
    });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { due_at: "2026-07-10T17:00:00.000Z" });
    expect(alerts).not.toHaveBeenCalled();
  });

  it("finishing and reopening a task raise completed and reopened", async () => {
    world({ before: {} });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { done: true });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { done: false });
    expect(alerts.mock.calls.map((c) => c[1].kind)).toEqual(["completed", "reopened"]);
    expect(alerts.mock.calls[0][1]).toMatchObject({ actorUserId: auth.subject });
  });

  it("a second tap on done (unchanged) raises nothing", async () => {
    world({ before: {}, doneOutcome: "unchanged" });
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { done: true });
    expect(alerts).not.toHaveBeenCalled();
  });

  it("detail says whether the caller follows the task, and a remembered unfollow is not following", async () => {
    const detail = (follow: { unsubscribed_at: string | null } | null) => {
      const lookup = stubRoute(restMatch(env, "GET", "tasks"), () => [
        taskRow({ message_id: null, conversation_id: null, messages: null }),
      ]);
      const empty = (table: string) => stubRoute(restMatch(env, "GET", table), () => []);
      stubFetch(
        jwksRoute(auth),
        membersRoute(),
        numberAccessRoute(),
        subscriptionRoute(follow),
        lookup.route,
        empty("profiles").route,
        empty("attachments").route,
        empty("message_attachments").route,
        empty("conversation_events").route,
        empty("messages").route,
      );
    };
    const subscribed = async () =>
      ((await (await request("GET", `/v1/tasks/${TASK_ID}`)).json()) as {
        subscribed: boolean;
      }).subscribed;

    detail({ unsubscribed_at: null });
    expect(await subscribed()).toBe(true);
    detail({ unsubscribed_at: "2026-11-10T12:00:00.000Z" });
    expect(await subscribed()).toBe(false);
    detail(null);
    expect(await subscribed()).toBe(false);
  });
});
