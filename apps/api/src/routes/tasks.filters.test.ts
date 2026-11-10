/**
 * #690: the task list's contact, creator, source, files and references filters,
 * the updated sort, and finding a task by its number. The suite stubs the network
 * edge (PostgREST over fetch) and asserts what the routes ask the database.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { companyContext } from "../auth/company";
import { jwtAuth } from "../auth/jwt";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { restMatch, rpcMatch, stubRoute } from "../test/messaging-support";
import {
  authorizeRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { tasksRoutes } from "./tasks";

vi.mock("../tasks/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/notify")>()),
  notifyTaskChangeSafely: vi.fn(async () => undefined),
}));

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const TASK_ID = "77777777-0000-4000-8000-000000000077";
const CONTACT_ID = "c0cccccc-0000-4000-8000-0000000000c0";
const CONV_A = "bbbbbbbb-0000-4000-8000-00000000000b";
const CONV_B = "bbbbbbbb-0000-4000-8000-00000000000c";
const HIDDEN_NUMBER = "99999999-0000-4000-8000-000000000099";

let auth: TestAuth;
const env: Env = completeEnv();

const app = (() => {
  const a = new Hono<AppEnv>();
  a.use("/v1/*", jwtAuth());
  a.use("/v1/*", companyContext());
  a.route("/v1", tasksRoutes);
  a.onError((error, c) =>
    error instanceof ApiError
      ? errorResponse(c, error.code, error.message)
      : c.json({ error: { code: "internal_error", message: String(error) } }, 500),
  );
  return a;
})();

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function request(method: string, path: string, body?: unknown): Promise<Response> {
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

const members = () => authorizeRoute(env, { id: "11111111-0000-4000-8000-000000000011", role: "member" });

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    number: 142,
    message_id: null,
    conversation_id: null,
    title: "Furnace service",
    description: "",
    assigned_user_id: null,
    due_at: null,
    created_by_user_id: auth?.subject,
    created_at: "2026-11-10T12:00:00.000Z",
    updated_at: "2026-11-11T09:00:00.000Z",
    priority: "normal",
    series_id: null,
    occurrence_no: null,
    ...overrides,
  };
}

/** No number access rules unless a test says so. */
const noRules = () => stubRoute(rpcMatch(env, "member_number_levels"), () => []).route;
const rulesHiding = () =>
  stubRoute(rpcMatch(env, "member_number_levels"), () => [
    { phone_number_id: HIDDEN_NUMBER, level: "none" },
  ]).route;

function tail(): FetchRoute[] {
  return [
    stubRoute(restMatch(env, "GET", "task_tags"), () => []).route,
    stubRoute(restMatch(env, "GET", "task_series"), () => []).route,
    stubRoute(restMatch(env, "GET", "task_assignees"), () => []).route,
  ];
}

describe("GET /v1/tasks: the #690 filters", () => {
  it("returns the task number and the contact of the thread", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({
        conversation_id: CONV_A,
        thread: { contact: { id: CONTACT_ID, name: "Jane Smith", deleted_at: null } },
      }),
    ]);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    const response = await request("GET", "/v1/tasks?status=open");
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]).toMatchObject({
      number: 142,
      contact: { id: CONTACT_ID, name: "Jane Smith" },
    });
    expect(body.data[0]).not.toHaveProperty("thread");
    expect(list.calls[0].url.searchParams.get("select")).toContain("number");
  });

  it("filters by contact: the task's own link, or any of the contact's threads", async () => {
    const conversations = stubRoute(restMatch(env, "GET", "conversations"), () => [
      { id: CONV_A },
      { id: CONV_B },
    ]);
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), conversations.route, list.route, ...tail());
    const response = await request("GET", `/v1/tasks?contact_id=${CONTACT_ID}`);
    expect(response.status).toBe(200);
    expect(conversations.calls[0].url.searchParams.get("contact_id")).toBe(`eq.${CONTACT_ID}`);
    expect(list.calls[0].url.searchParams.get("or")).toBe(
      `(contact_id.eq.${CONTACT_ID},conversation_id.in.(${CONV_A},${CONV_B}))`,
    );
  });

  it("filters by creator, with me meaning the caller", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", "/v1/tasks?created_by=me");
    expect(list.calls[0].url.searchParams.get("created_by_user_id")).toBe(`eq.${auth.subject}`);
  });

  it.each([
    ["text", "message_id", "not.is.null"],
    ["call", "source_call_id", "not.is.null"],
  ])("source=%s", async (source, column, expected) => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", `/v1/tasks?source=${source}`);
    expect(list.calls[0].url.searchParams.get(column)).toBe(expected);
  });

  it("source=none is no message and no call", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", "/v1/tasks?source=none");
    expect(list.calls[0].url.searchParams.get("message_id")).toBe("is.null");
    expect(list.calls[0].url.searchParams.get("source_call_id")).toBe("is.null");
  });

  it("has_attachments reads the files column", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", "/v1/tasks?has_attachments=true");
    expect(list.calls[0].url.searchParams.get("task_has_attachments")).toBe("eq.true");
  });

  it("has_references joins the references, and leaves out ones written on a denied number", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ record_references: [{ id: "x" }] }),
    ]);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    const open = await request("GET", "/v1/tasks?has_references=true");
    expect(list.calls[0].url.searchParams.get("select")).toContain(
      "record_references!target_task_id!inner(id)",
    );
    expect(list.calls[0].url.searchParams.get("record_references.or")).toBeNull();
    const body = (await open.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]).not.toHaveProperty("record_references");

    const hiddenList = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), rulesHiding(), hiddenList.route, ...tail());
    await request("GET", "/v1/tasks?has_references=true");
    expect(hiddenList.calls[0].url.searchParams.get("record_references.or")).toBe(
      `(source_number_id.is.null,source_number_id.not.in.(${HIDDEN_NUMBER}))`,
    );
  });

  it("an explicit filter opts out of the open-and-mine default", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", "/v1/tasks?source=call");
    expect(list.calls[0].url.searchParams.get("task_done_at")).toBeNull();
    expect(list.calls[0].url.searchParams.get("task_assignees.user_id")).toBeNull();
  });

  it("refuses bad values and the map combination before reading", async () => {
    for (const q of ["contact_id=nope", "created_by=nope", "source=fax", "has_location=true&source=call"]) {
      const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
      stubFetch(jwksRoute(auth), members(), noRules(), list.route);
      const response = await request("GET", `/v1/tasks?${q}`);
      expect(response.status).toBe(422);
      expect(list.calls).toHaveLength(0);
    }
  });

  it("sorts by updated, newest first, and pages on (updated_at, id)", async () => {
    const rows = [
      taskRow({ id: "77777777-0000-4000-8000-000000000001" }),
      taskRow({ id: "77777777-0000-4000-8000-000000000002", updated_at: "2026-11-10T09:00:00.000Z" }),
    ];
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => rows);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    const first = await request("GET", "/v1/tasks?sort=updated&status=open&limit=1");
    const body = (await first.json()) as { data: { id: string }[]; next_cursor: string | null };
    expect(list.calls[0].url.searchParams.get("order")).toBe("updated_at.desc,id.desc");
    expect(body.next_cursor).not.toBeNull();

    const next = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), next.route, ...tail());
    await request("GET", `/v1/tasks?sort=updated&status=open&cursor=${body.next_cursor}`);
    expect(next.calls[0].url.searchParams.get("or")).toContain("updated_at.lt.2026-11-11T09:00:00.000Z");
  });

  it.each(["T-142", "t142", "#142", "142"])("q=%s also finds task number 142", async (q) => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", `/v1/tasks?q=${encodeURIComponent(q)}`);
    expect(list.calls[0].url.searchParams.get("or")).toBe("(title.ilike.%142%,number.eq.142)");
  });

  it("a plain q is still only a title search", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), noRules(), list.route, ...tail());
    await request("GET", "/v1/tasks?q=furnace");
    expect(list.calls[0].url.searchParams.get("title")).toBe("ilike.%furnace%");
  });
});
