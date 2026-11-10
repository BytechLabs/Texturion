/**
 * #690: task links, linked tasks and reference chips. Real middleware and route
 * code; the network edge (PostgREST over fetch) is the only stub.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { taskReferenceRoutes } from "./task-references";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const TASK_ID = "cccccccc-1111-4222-8333-444444444444";
const OTHER_ID = "dddddddd-1111-4222-8333-444444444444";
const CONV_ID = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(taskReferenceRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function harness(role = "member") {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(auth.subject, role));
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/tasks", () => [{ id: TASK_ID, conversation_id: null }]);
  return sb;
}

async function call(
  sb: ReturnType<typeof harness>,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), path, {
    companyId: COMPANY_ID,
    method: init.method,
    body: init.body,
  });
}

const LINKS = [{ relation: "blocked_by", task_id: OTHER_ID, number: 4, title: "Order the part", done: false }];

describe("GET /v1/tasks/:id/links", () => {
  it("returns what the other tasks are to this one", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_task_links", () => ({ outcome: "ok", items: LINKS }));
    const res = await call(sb, `/v1/tasks/${TASK_ID}/links`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: LINKS });
  });

  it("404s a task the caller cannot see", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_task_links", () => ({ outcome: "not_found" }));
    expect((await call(sb, `/v1/tasks/${TASK_ID}/links`)).status).toBe(404);
  });
});

describe("POST /v1/tasks/:id/links", () => {
  function withLink(outcome: string) {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_set_task_link", () => ({ outcome }));
    sb.on("POST", "/rest/v1/rpc/api_task_links", () => ({ outcome: "ok", items: LINKS }));
    return sb;
  }
  const body = { relation: "blocked_by", task_id: OTHER_ID };

  it("adds the link, names the actor, and returns the links", async () => {
    const sb = withLink("ok");
    const res = await call(sb, `/v1/tasks/${TASK_ID}/links`, { method: "POST", body });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: LINKS });
    expect(sb.find("POST", "/rest/v1/rpc/api_set_task_link")[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_task_id: TASK_ID,
      p_other_task_id: OTHER_ID,
      p_relation: "blocked_by",
      p_add: true,
      p_actor_user_id: auth.subject,
    });
  });

  it("is a 200 no-op the second time", async () => {
    const res = await call(withLink("unchanged"), `/v1/tasks/${TASK_ID}/links`, { method: "POST", body });
    expect(res.status).toBe(200);
  });

  it("refuses a loop with 422 and a second parent with 409", async () => {
    expect((await call(withLink("cycle"), `/v1/tasks/${TASK_ID}/links`, { method: "POST", body })).status).toBe(422);
    expect((await call(withLink("has_parent"), `/v1/tasks/${TASK_ID}/links`, { method: "POST", body })).status).toBe(409);
    expect((await call(withLink("invalid"), `/v1/tasks/${TASK_ID}/links`, { method: "POST", body })).status).toBe(422);
  });

  it("404s when the other task is not there for this caller", async () => {
    expect((await call(withLink("not_found"), `/v1/tasks/${TASK_ID}/links`, { method: "POST", body })).status).toBe(404);
  });

  it("validates the body", async () => {
    const sb = withLink("ok");
    expect((await call(sb, `/v1/tasks/${TASK_ID}/links`, { method: "POST", body: { relation: "friend", task_id: OTHER_ID } })).status).toBe(422);
    expect((await call(sb, `/v1/tasks/${TASK_ID}/links`, { method: "POST", body: { relation: "parent", task_id: "x" } })).status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_task_link")).toHaveLength(0);
  });
});

describe("DELETE /v1/tasks/:id/links/:otherId", () => {
  it("removes the link", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_set_task_link", () => ({ outcome: "ok" }));
    sb.on("POST", "/rest/v1/rpc/api_task_links", () => ({ outcome: "ok", items: [] }));
    const res = await call(sb, `/v1/tasks/${TASK_ID}/links/${OTHER_ID}?relation=blocks`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_task_link")[0].body).toMatchObject({
      p_relation: "blocks",
      p_add: false,
    });
  });

  it("needs a relation", async () => {
    const sb = harness();
    expect((await call(sb, `/v1/tasks/${TASK_ID}/links/${OTHER_ID}`, { method: "DELETE" })).status).toBe(422);
  });
});

describe("linked tasks", () => {
  const ITEMS = [{ id: TASK_ID, number: 7, title: "Quote", done: false, due_at: null, how: ["anchored"] }];

  it("lists them for a contact", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_linked_tasks", () => ({ outcome: "ok", items: ITEMS }));
    const res = await call(sb, `/v1/contacts/${OTHER_ID}/linked-tasks`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ITEMS });
    expect(sb.find("POST", "/rest/v1/rpc/api_linked_tasks")[0].body).toMatchObject({
      p_kind: "contact",
      p_id: OTHER_ID,
    });
  });

  it("404s a conversation the caller is denied", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_linked_tasks", () => ({ outcome: "not_found" }));
    sb.on("GET", "/rest/v1/conversations", () => []);
    const res = await call(sb, `/v1/conversations/${CONV_ID}/linked-tasks`);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/references/resolve", () => {
  it("passes the numbers and prefixes through and returns the answer", async () => {
    const sb = harness();
    const answer = { tasks: [{ number: 142, id: TASK_ID, title: "Fix", done: true }], contacts: [], conversations: [] };
    sb.on("POST", "/rest/v1/rpc/api_resolve_references", () => answer);
    const res = await call(sb, "/v1/references/resolve?tasks=142,7&contacts=1a2b3c4d&conversations=ABCDEF01");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    expect(sb.find("POST", "/rest/v1/rpc/api_resolve_references")[0].body).toMatchObject({
      p_task_numbers: [142, 7],
      p_contact_prefixes: ["1a2b3c4d"],
      p_conv_prefixes: ["ABCDEF01"],
    });
  });

  it("refuses a malformed list", async () => {
    const sb = harness();
    expect((await call(sb, "/v1/references/resolve?tasks=abc")).status).toBe(422);
    expect((await call(sb, "/v1/references/resolve?contacts=1234")).status).toBe(422);
    expect((await call(sb, `/v1/references/resolve?tasks=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}`)).status).toBe(422);
  });
});

describe("customer texts are never read for references (#690)", () => {
  const src = (file: string) => readFileSync(join(__dirname, file), "utf8");

  it("only the internal text routes call the reference writer", () => {
    const users = ["tasks.ts", "task-activity.ts", "conversations.ts", "messages.ts", "compose.ts", "scheduled-messages.ts"].filter(
      (file) => {
        try {
          return src(file).includes("syncReferences(");
        } catch {
          return false;
        }
      },
    );
    expect(users.sort()).toEqual(["conversations.ts", "task-activity.ts", "tasks.ts"]);
  });

  it("in conversations.ts the call sits in the note handler and nowhere near a send", () => {
    const text = src("conversations.ts");
    const call = text.indexOf("syncReferences(c, db");
    expect(call).toBeGreaterThan(0);
    const before = text.slice(0, call);
    const handler = before.lastIndexOf("conversationsRoutes.post(");
    expect(before.slice(handler, handler + 120)).toContain('"/conversations/:id/notes"');
  });
});
