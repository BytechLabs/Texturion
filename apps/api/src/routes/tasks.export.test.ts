/**
 * #745: the task list's Export is a direct download, not a queued data export.
 *
 * What these pin: the capability gate, the attachment headers and the byte-order
 * mark, that spreadsheet formulas arrive defused, that the list's own filters
 * narrow the file, that a hidden number's tasks are withheld and counted, and
 * that no data_exports row or queue call is ever made.
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

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const USER_ID = "11111111-0000-4000-8000-000000000011";
const HIDDEN_NUMBER = "99999999-0000-4000-8000-000000000099";
const TAG_ID = "7a7a7a7a-0000-4000-8000-0000000000aa";

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
});

async function get(path: string): Promise<Response> {
  return app.fetch(
    new Request(`https://api.loonext.com${path}`, {
      headers: { Authorization: `Bearer ${await auth.token()}`, "X-Company-Id": COMPANY_ID },
    }),
    env,
  );
}

function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Replace the flue",
    description: "Customer says it whistles",
    due_at: null,
    created_at: "2026-11-01T09:00:00.000Z",
    assigned_user_id: null,
    conversation_id: "c1",
    messages: { done_at: null },
    conversations: {
      phone_number_id: null,
      contact_phone_e164: "+14155559001",
      contacts: { name: "Dana Reed" },
    },
    ...over,
  };
}

function world(options: { role?: string; tasks?: unknown[]; hidden?: string[] } = {}) {
  const role = options.role ?? "owner";
  const tasks = stubRoute(restMatch(env, "GET", "tasks"), () => options.tasks ?? [task()]);
  const audit = stubRoute(restMatch(env, "POST", "audit_log"), () => []);
  const queue = stubRoute(rpcMatch(env, "request_data_export"), () => ({}));
  const exportsTable = stubRoute(restMatch(env, "POST", "data_exports"), () => []);
  const routes: FetchRoute[] = [
    jwksRoute(auth),
    authorizeRoute(env, { id: USER_ID, role }),
    stubRoute(restMatch(env, "GET", "company_members"), () => ({ role })).route,
    stubRoute(rpcMatch(env, "member_number_levels"), () =>
      (options.hidden ?? []).map((id) => ({ phone_number_id: id, level: "none" })),
    ).route,
    stubRoute(restMatch(env, "GET", "profiles"), () => []).route,
    tasks.route,
    audit.route,
    queue.route,
    exportsTable.route,
  ];
  return { routes, tasks, audit, queue, exportsTable };
}

async function text(res: Response): Promise<string> {
  return new TextDecoder("utf-8").decode(await res.arrayBuffer());
}

describe("GET /v1/tasks/export.csv (#745)", () => {
  it("is refused to a member: every task names a customer", async () => {
    const w = world({ role: "member" });
    stubFetch(...w.routes);
    const res = await get("/v1/tasks/export.csv");
    expect(res.status).toBe(403);
    expect(w.tasks.calls).toHaveLength(0);
  });

  it("answers with an attachment CSV that opens correctly in Excel", async () => {
    const w = world();
    stubFetch(...w.routes);
    const res = await get("/v1/tasks/export.csv?status=open");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="tasks.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes.slice(3));
    expect(body.split("\r\n")[0]).toBe("raised,customer,task,detail,due,assigned to,state");
    expect(body).toContain("Dana Reed");
    expect(body).toContain("Replace the flue");
  });

  it("creates no data export: no queue call and no data_exports row", async () => {
    const w = world();
    stubFetch(...w.routes);
    await get("/v1/tasks/export.csv");
    expect(w.queue.calls).toHaveLength(0);
    expect(w.exportsTable.calls).toHaveLength(0);
  });

  it("defuses spreadsheet formulas and quotes commas, quotes and newlines", async () => {
    const w = world({
      tasks: [
        task({
          title: '=HYPERLINK("http://evil.example","x")',
          description: 'He said "call back, soon"\nthanks',
          conversations: {
            phone_number_id: null,
            contact_phone_e164: "+14155559001",
            contacts: { name: "+cmd|calc" },
          },
        }),
      ],
    });
    stubFetch(...w.routes);
    const body = await text(await get("/v1/tasks/export.csv"));
    expect(body).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(body).toContain("'=HYPERLINK");
    expect(body).not.toMatch(/(^|,)"?\+cmd/m);
    expect(body).toContain('"He said ""call back, soon""\nthanks"');
  });

  it("passes the list's own filters to the read", async () => {
    const w = world();
    stubFetch(...w.routes);
    const res = await get(
      `/v1/tasks/export.csv?status=done&assigned_user_id=me&due_before=2026-12-01T00:00:00Z&priority=high,urgent&tag_id=${TAG_ID}&q=flue`,
    );
    expect(res.status).toBe(200);
    const url = w.tasks.calls[0].url;
    expect(url.searchParams.get("task_done_at")).toBe("not.is.null");
    expect(url.searchParams.get("task_assignees.user_id")).toBe(`eq.${auth.subject}`);
    expect(url.searchParams.get("due_at")).toBe("lte.2026-12-01T00:00:00Z");
    expect(url.searchParams.get("priority")).toBe("in.(high,urgent)");
    expect(url.searchParams.get("task_tags.tag_id")).toBe(`eq.${TAG_ID}`);
    expect(url.searchParams.get("title")).toBe("ilike.%flue%");
    expect(url.searchParams.get("select")).toContain("task_tags!inner(tag_id)");
  });

  it("with no filter it is the list's default: my open tasks", async () => {
    const w = world();
    stubFetch(...w.routes);
    await get("/v1/tasks/export.csv");
    const url = w.tasks.calls[0].url;
    expect(url.searchParams.get("task_done_at")).toBe("is.null");
    expect(url.searchParams.get("task_assignees.user_id")).toBe(`eq.${auth.subject}`);
  });

  it("refuses a malformed filter the way the list does", async () => {
    const w = world();
    stubFetch(...w.routes);
    expect((await get("/v1/tasks/export.csv?status=nope")).status).toBe(422);
    expect((await get("/v1/tasks/export.csv?tag_id=x")).status).toBe(422);
  });

  it("states what was withheld and whether it stopped at the cap", async () => {
    // Only owners and admins hold `contacts.bulk`, and they resolve unrestricted,
    // so nothing is withheld for them; the per-number withholding itself is
    // asserted where it is built (workspace/tasks-export.test.ts).
    const w = world({ role: "admin", hidden: [HIDDEN_NUMBER] });
    stubFetch(...w.routes);
    const res = await get("/v1/tasks/export.csv");
    expect(res.headers.get("x-export-withheld")).toBe("0");
    expect(res.headers.get("x-export-capped")).toBe("false");
  });

  it("writes one audit row saying how much left", async () => {
    const w = world();
    stubFetch(...w.routes);
    await get("/v1/tasks/export.csv");
    const row = JSON.stringify(w.audit.calls[0].body);
    expect(row).toContain("contacts.exported");
    expect(row).toContain('"count":1');
  });
});
