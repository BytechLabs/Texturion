/**
 * #693: task priority, labels and repeating jobs on the task routes. The suite
 * stubs the network edge (PostgREST over fetch) and asserts what the routes ask
 * of the RPCs and what they hand back; the rules themselves are in
 * supabase/tests/task_priority_labels_repeats.test.sql.
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
const SERIES_ID = "55555555-0000-4000-8000-000000000055";
const TAG_ID = "66666666-0000-4000-8000-000000000066";
const OTHER_TAG_ID = "66666666-0000-4000-8000-000000000067";

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

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    message_id: null,
    conversation_id: null,
    title: "Furnace service",
    description: "",
    assigned_user_id: null,
    due_at: "2027-03-01T14:00:00.000Z",
    created_by_user_id: auth?.subject,
    created_at: "2026-11-10T12:00:00.000Z",
    updated_at: "2026-11-10T12:00:00.000Z",
    priority: "normal",
    series_id: null,
    occurrence_no: null,
    ...overrides,
  };
}

const SERIES_ROW = {
  id: SERIES_ID,
  kind: "after_done",
  unit: "month",
  every: 6,
  weekdays: null,
  month_day: null,
  nth: null,
  nth_weekday: null,
  ends_kind: "after",
  ends_on: null,
  ends_after: 4,
  paused: false,
  stopped_at: null,
};

const members = () => authorizeRoute(env, { id: "11111111-0000-4000-8000-000000000011", role: "member" });
const noAccessRules = () => stubRoute(rpcMatch(env, "member_number_levels"), () => []).route;

/** The reads every task response ends with, plus the reminder sync after a write. */
function tail(
  options: { labels?: unknown[]; series?: unknown[] } = {},
): FetchRoute[] {
  return [
    stubRoute(restMatch(env, "GET", "task_tags"), () => options.labels ?? []).route,
    stubRoute(restMatch(env, "GET", "task_series"), () => options.series ?? []).route,
    stubRoute(restMatch(env, "GET", "tasks"), () => []).route,
    stubRoute(restMatch(env, "GET", "appointment_reminder_rules"), () => []).route,
    stubRoute(rpcMatch(env, "api_sync_task_reminders"), () => ({ outcome: "synced" })).route,
  ];
}

describe("GET /v1/tasks: priority, labels, repeat", () => {
  it("filters by a priority list and by tag, and says which to the database", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), list.route, ...tail());
    const response = await request(
      "GET",
      `/v1/tasks?priority=high,urgent&tag_id=${TAG_ID}&status=open`,
    );
    expect(response.status).toBe(200);
    const url = list.calls[0].url;
    expect(url.searchParams.get("priority")).toBe("in.(high,urgent)");
    expect(url.searchParams.get("task_tags.tag_id")).toBe(`eq.${TAG_ID}`);
    expect(url.searchParams.get("select")).toContain("task_tags!inner(tag_id)");
  });

  it("refuses an unknown priority, a bad tag id and a bad sort before reading", async () => {
    for (const q of ["priority=asap", "tag_id=nope", "sort=random"]) {
      const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
      stubFetch(jwksRoute(auth), members(), list.route);
      const response = await request("GET", `/v1/tasks?${q}`);
      expect(response.status).toBe(422);
      expect(list.calls).toHaveLength(0);
    }
  });

  it("sorts by priority, highest first, and pages on (rank, created_at, id)", async () => {
    const rows = [
      taskRow({ id: "77777777-0000-4000-8000-000000000001", priority: "urgent" }),
      taskRow({ id: "77777777-0000-4000-8000-000000000002", priority: "high" }),
    ];
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => rows);
    stubFetch(jwksRoute(auth), members(), list.route, ...tail());
    const first = await request("GET", "/v1/tasks?sort=priority&status=open&limit=1");
    const body = (await first.json()) as { data: { id: string }[]; next_cursor: string | null };
    expect(list.calls[0].url.searchParams.get("order")).toBe(
      "priority_rank.desc,created_at.desc,id.desc",
    );
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).not.toBeNull();

    const next = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), next.route, ...tail());
    await request("GET", `/v1/tasks?sort=priority&status=open&cursor=${body.next_cursor}`);
    const filter = next.calls[0].url.searchParams.get("or") ?? "";
    expect(filter).toContain("priority_rank.lt.4");
    expect(filter).toContain("and(priority_rank.eq.4,created_at.lt.2026-11-10T12:00:00.000Z)");
  });

  it("a created-sorted cursor is refused on the priority sort", async () => {
    stubFetch(jwksRoute(auth), members(), ...tail());
    const response = await request("GET", "/v1/tasks?sort=priority&cursor=garbage");
    expect(response.status).toBe(422);
  });

  it("puts labels and the repeat on each row", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ series_id: SERIES_ID, occurrence_no: 2 }),
      taskRow({ id: "77777777-0000-4000-8000-000000000002" }),
    ]);
    stubFetch(
      jwksRoute(auth),
      members(),
      list.route,
      ...tail({
        labels: [
          { task_id: TASK_ID, tag: { id: TAG_ID, name: "warranty", color: null } },
          { task_id: TASK_ID, tag: { id: OTHER_TAG_ID, name: "parts needed", color: "#aa0000" } },
        ],
        series: [SERIES_ROW],
      }),
    );
    const response = await request("GET", "/v1/tasks?status=open");
    const body = (await response.json()) as {
      data: { id: string; labels: { name: string }[]; repeat: unknown; priority: string }[];
    };
    expect(body.data[0].labels.map((l) => l.name)).toEqual(["parts needed", "warranty"]);
    expect(body.data[0].repeat).toEqual({
      id: SERIES_ID,
      kind: "after_done",
      unit: "month",
      every: 6,
      weekdays: null,
      month_day: null,
      nth: null,
      nth_weekday: null,
      ends: { kind: "after", on: null, after: 4 },
      paused: false,
      stopped: false,
    });
    expect(body.data[1].labels).toEqual([]);
    expect(body.data[1].repeat).toBeNull();
    expect(body.data[0].priority).toBe("normal");
  });
});

describe("POST /v1/tasks: priority, labels, repeat", () => {
  function createRoutes(task = taskRow({ priority: "urgent" })) {
    const create = stubRoute(rpcMatch(env, "create_task"), () => ({ outcome: "created", task }));
    const tags = stubRoute(rpcMatch(env, "api_set_task_tags"), () => ({
      outcome: "updated",
      labels: [],
    }));
    const repeat = stubRoute(rpcMatch(env, "api_set_task_repeat"), () => ({
      outcome: "set",
      task: { ...task, series_id: SERIES_ID, occurrence_no: 1 },
    }));
    return { create, tags, repeat };
  }

  it("forwards the priority, then the labels, then the repeat", async () => {
    const r = createRoutes();
    stubFetch(
      jwksRoute(auth),
      members(),
      noAccessRules(),
      r.create.route,
      r.tags.route,
      r.repeat.route,
      ...tail({ series: [SERIES_ROW] }),
    );
    const response = await request("POST", "/v1/tasks", {
      title: "Furnace service",
      due_at: "2027-03-01T14:00:00.000Z",
      priority: "urgent",
      label_ids: [TAG_ID],
      repeat: { kind: "after_done", unit: "month", every: 6 },
    });
    expect(response.status).toBe(201);
    expect(r.create.calls[0].body).toMatchObject({ p_priority: "urgent" });
    expect(r.tags.calls[0].body).toMatchObject({ p_task_id: TASK_ID, p_add: [TAG_ID] });
    expect(r.repeat.calls[0].body).toMatchObject({
      p_task_id: TASK_ID,
      p_repeat: { kind: "after_done", unit: "month", every: 6 },
    });
    const body = (await response.json()) as { repeat: { kind: string }; series_id: string };
    expect(body.repeat.kind).toBe("after_done");
  });

  it("defaults the priority to normal and makes no label or repeat call", async () => {
    const r = createRoutes(taskRow());
    stubFetch(jwksRoute(auth), members(), noAccessRules(), r.create.route, r.tags.route, r.repeat.route, ...tail());
    const response = await request("POST", "/v1/tasks", { title: "Plain" });
    expect(response.status).toBe(201);
    expect(r.create.calls[0].body).toMatchObject({ p_priority: "normal" });
    expect(r.tags.calls).toHaveLength(0);
    expect(r.repeat.calls).toHaveLength(0);
  });

  it("refuses a schedule with no due date before creating anything", async () => {
    const r = createRoutes();
    stubFetch(jwksRoute(auth), members(), noAccessRules(), r.create.route, ...tail());
    const response = await request("POST", "/v1/tasks", {
      title: "Weekly",
      repeat: { kind: "schedule", unit: "week" },
    });
    expect(response.status).toBe(422);
    expect(r.create.calls).toHaveLength(0);
  });

  it("refuses an unknown priority and a rule the schema does not know", async () => {
    stubFetch(jwksRoute(auth), members(), noAccessRules(), ...tail());
    for (const body of [
      { title: "x", priority: "asap" },
      { title: "x", repeat: { kind: "sometimes", unit: "week" } },
      { title: "x", repeat: { kind: "after_done", unit: "week", weekdays: [8] } },
    ]) {
      expect((await request("POST", "/v1/tasks", body)).status).toBe(422);
    }
  });

  it("maps the rule check in SQL to a 422", async () => {
    const create = stubRoute(rpcMatch(env, "create_task"), () => ({
      outcome: "created",
      task: taskRow(),
    }));
    const repeat = stubRoute(rpcMatch(env, "api_set_task_repeat"), () => ({
      outcome: "invalid",
      reason: "ends",
    }));
    stubFetch(jwksRoute(auth), members(), noAccessRules(), create.route, repeat.route, ...tail());
    const response = await request("POST", "/v1/tasks", {
      title: "x",
      repeat: { kind: "after_done", unit: "day", ends: { kind: "on", on: "2000-01-01" } },
    });
    expect(response.status).toBe(422);
  });
});

describe("PATCH /v1/tasks/:id: priority, repeat, scope", () => {
  it("sets the priority through update_task", async () => {
    const update = stubRoute(rpcMatch(env, "update_task"), () => ({
      outcome: "updated",
      task: taskRow({ priority: "high" }),
    }));
    stubFetch(jwksRoute(auth), members(), update.route, ...tail());
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, { priority: "high" });
    expect(response.status).toBe(200);
    expect(update.calls[0].body).toMatchObject({ p_priority: "high" });
    expect(((await response.json()) as { priority: string }).priority).toBe("high");
  });

  it("clears a repeat with null and sets one with an object", async () => {
    const repeat = stubRoute(rpcMatch(env, "api_set_task_repeat"), (call) => ({
      outcome: (call.body as { p_repeat: unknown }).p_repeat === null ? "cleared" : "set",
      task: taskRow(),
    }));
    stubFetch(jwksRoute(auth), members(), repeat.route, ...tail());
    const cleared = await request("PATCH", `/v1/tasks/${TASK_ID}`, { repeat: null });
    expect(cleared.status).toBe(200);
    expect(repeat.calls[0].body).toMatchObject({ p_repeat: null });

    const set = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      repeat: { kind: "schedule", unit: "week", weekdays: [1, 3] },
    });
    expect(set.status).toBe(200);
    expect(repeat.calls[1].body).toMatchObject({
      p_repeat: { kind: "schedule", unit: "week", weekdays: [1, 3] },
    });
  });

  it("this and future also edits the series, with only the fields sent", async () => {
    const update = stubRoute(rpcMatch(env, "update_task"), () => ({
      outcome: "updated",
      task: taskRow({ title: "New title", series_id: SERIES_ID, occurrence_no: 2 }),
    }));
    const edit = stubRoute(rpcMatch(env, "api_edit_task_series"), () => ({
      outcome: "updated",
      later: 2,
    }));
    stubFetch(jwksRoute(auth), members(), update.route, edit.route, ...tail());
    const response = await request("PATCH", `/v1/tasks/${TASK_ID}`, {
      title: "New title",
      priority: "high",
      scope: "future",
    });
    expect(response.status).toBe(200);
    expect(edit.calls).toHaveLength(1);
    expect(edit.calls[0].body).toMatchObject({
      p_task_id: TASK_ID,
      p_changes: { title: "New title", priority: "high" },
    });
    expect(Object.keys((edit.calls[0].body as { p_changes: object }).p_changes).sort()).toEqual([
      "priority",
      "title",
    ]);
  });

  it("this one (the default) leaves the series alone", async () => {
    const update = stubRoute(rpcMatch(env, "update_task"), () => ({
      outcome: "updated",
      task: taskRow({ title: "New title" }),
    }));
    const edit = stubRoute(rpcMatch(env, "api_edit_task_series"), () => ({ outcome: "updated" }));
    stubFetch(jwksRoute(auth), members(), update.route, edit.route, ...tail());
    await request("PATCH", `/v1/tasks/${TASK_ID}`, { title: "New title" });
    expect(edit.calls).toHaveLength(0);
  });
});

describe("DELETE /v1/tasks/:id: this one or this and future", () => {
  const owner = () => authorizeRoute(env, { id: "11111111-0000-4000-8000-000000000011", role: "owner" });
  const lookup = (series: string | null) =>
    stubRoute(restMatch(env, "GET", "tasks"), () => [
      taskRow({ series_id: series, occurrence_no: series ? 2 : null }),
    ]);

  it("this one is delete_task, which skips an occurrence", async () => {
    const del = stubRoute(rpcMatch(env, "delete_task"), () => ({ outcome: "deleted" }));
    const series = stubRoute(rpcMatch(env, "api_delete_task_series"), () => ({ outcome: "deleted" }));
    stubFetch(jwksRoute(auth), owner(), lookup(SERIES_ID).route, del.route, series.route, ...tail());
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}`);
    expect(response.status).toBe(204);
    expect(del.calls).toHaveLength(1);
    expect(series.calls).toHaveLength(0);
  });

  it("this and future is api_delete_task_series", async () => {
    const del = stubRoute(rpcMatch(env, "delete_task"), () => ({ outcome: "deleted" }));
    const series = stubRoute(rpcMatch(env, "api_delete_task_series"), () => ({ outcome: "deleted" }));
    stubFetch(jwksRoute(auth), owner(), lookup(SERIES_ID).route, del.route, series.route, ...tail());
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}?scope=future`);
    expect(response.status).toBe(204);
    expect(series.calls[0].body).toMatchObject({ p_task_id: TASK_ID });
    expect(del.calls).toHaveLength(0);
  });

  it("this and future on a task that repeats nothing is an ordinary delete", async () => {
    const del = stubRoute(rpcMatch(env, "delete_task"), () => ({ outcome: "deleted" }));
    const series = stubRoute(rpcMatch(env, "api_delete_task_series"), () => ({ outcome: "deleted" }));
    stubFetch(jwksRoute(auth), owner(), lookup(null).route, del.route, series.route, ...tail());
    expect((await request("DELETE", `/v1/tasks/${TASK_ID}?scope=future`)).status).toBe(204);
    expect(del.calls).toHaveLength(1);
    expect(series.calls).toHaveLength(0);
  });

  it("refuses an unknown scope", async () => {
    stubFetch(jwksRoute(auth), owner(), lookup(null).route, ...tail());
    expect((await request("DELETE", `/v1/tasks/${TASK_ID}?scope=all`)).status).toBe(422);
  });
});

describe("task labels", () => {
  const taskLookup = () => stubRoute(restMatch(env, "GET", "tasks"), () => [taskRow()]).route;
  const tagLookup = () =>
    stubRoute(restMatch(env, "GET", "tags"), () => [{ id: TAG_ID, name: "warranty", color: null }]).route;

  it("adds a tag by id and returns the task's labels", async () => {
    const set = stubRoute(rpcMatch(env, "api_set_task_tags"), () => ({
      outcome: "updated",
      labels: [{ id: TAG_ID, name: "warranty", color: null }],
    }));
    stubFetch(jwksRoute(auth), members(), taskLookup(), tagLookup(), set.route);
    const response = await request("POST", `/v1/tasks/${TASK_ID}/tags`, { tag_id: TAG_ID });
    expect(response.status).toBe(201);
    expect(set.calls[0].body).toMatchObject({ p_add: [TAG_ID], p_remove: null });
    const body = (await response.json()) as { labels: unknown[] };
    expect(body.labels).toHaveLength(1);
  });

  it("this and future also labels the series", async () => {
    const set = stubRoute(rpcMatch(env, "api_set_task_tags"), () => ({ outcome: "updated", labels: [] }));
    const edit = stubRoute(rpcMatch(env, "api_edit_task_series"), () => ({ outcome: "updated" }));
    stubFetch(jwksRoute(auth), members(), taskLookup(), tagLookup(), set.route, edit.route);
    await request("POST", `/v1/tasks/${TASK_ID}/tags`, { tag_id: TAG_ID, scope: "future" });
    expect(edit.calls[0].body).toMatchObject({ p_changes: { labels_add: [TAG_ID] } });
  });

  it("needs exactly one of tag_id or name", async () => {
    stubFetch(jwksRoute(auth), members(), taskLookup());
    expect((await request("POST", `/v1/tasks/${TASK_ID}/tags`, {})).status).toBe(422);
    expect(
      (await request("POST", `/v1/tasks/${TASK_ID}/tags`, { tag_id: TAG_ID, name: "x" })).status,
    ).toBe(422);
  });

  it("a name goes through the workspace's find-or-create, and a locked list refuses", async () => {
    const find = stubRoute(rpcMatch(env, "api_find_or_create_tag"), () => [
      { id: null, name: null, color: null, refused: true, reason: "locked" },
    ]);
    stubFetch(jwksRoute(auth), members(), taskLookup(), find.route);
    const response = await request("POST", `/v1/tasks/${TASK_ID}/tags`, { name: "brand new" });
    expect(response.status).toBe(403);
  });

  it("removes a label and says so with 204; a label that is not on it is 404", async () => {
    const attached = stubRoute(restMatch(env, "GET", "task_tags"), () => [{ tag_id: TAG_ID }]);
    const set = stubRoute(rpcMatch(env, "api_set_task_tags"), () => ({ outcome: "updated", labels: [] }));
    stubFetch(jwksRoute(auth), members(), taskLookup(), attached.route, set.route);
    const response = await request("DELETE", `/v1/tasks/${TASK_ID}/tags/${TAG_ID}`);
    expect(response.status).toBe(204);
    expect(set.calls[0].body).toMatchObject({ p_remove: [TAG_ID] });

    const none = stubRoute(restMatch(env, "GET", "task_tags"), () => []);
    stubFetch(jwksRoute(auth), members(), taskLookup(), none.route, set.route);
    expect((await request("DELETE", `/v1/tasks/${TASK_ID}/tags/${TAG_ID}`)).status).toBe(404);
  });
});

describe("POST /v1/tasks/bulk: priority and labels", () => {
  const bulk = (result: unknown) => stubRoute(rpcMatch(env, "api_bulk_tasks"), () => result);

  it("set_priority carries the value", async () => {
    const rpc = bulk({ action: "set_priority", matched: 1, applied: [], failed: [], capped: false });
    stubFetch(jwksRoute(auth), members(), noAccessRules(), rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "set_priority",
      ids: [TASK_ID],
      priority: "urgent",
    });
    expect(response.status).toBe(200);
    expect(rpc.calls[0].body).toMatchObject({ p_action: "set_priority", p_priority: "urgent" });
  });

  it("add_label carries the tag and needs one", async () => {
    const rpc = bulk({ action: "add_label", matched: 1, applied: [], failed: [], capped: false });
    stubFetch(jwksRoute(auth), members(), noAccessRules(), rpc.route);
    const ok = await request("POST", "/v1/tasks/bulk", {
      action: "add_label",
      ids: [TASK_ID],
      tag_id: TAG_ID,
    });
    expect(ok.status).toBe(200);
    expect(rpc.calls[0].body).toMatchObject({ p_tag_id: TAG_ID });
    for (const body of [
      { action: "add_label", ids: [TASK_ID] },
      { action: "set_priority", ids: [TASK_ID] },
      { action: "set_priority", ids: [TASK_ID], priority: "asap" },
    ]) {
      expect((await request("POST", "/v1/tasks/bulk", body)).status).toBe(422);
    }
  });

  it("a tag from another workspace is a 422", async () => {
    const rpc = bulk({ error: "tag_not_found" });
    stubFetch(jwksRoute(auth), members(), noAccessRules(), rpc.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "remove_label",
      ids: [TASK_ID],
      tag_id: OTHER_TAG_ID,
    });
    expect(response.status).toBe(422);
  });

  it("a select-all filter can name a priority and a tag", async () => {
    const list = stubRoute(restMatch(env, "GET", "tasks"), () => []);
    stubFetch(jwksRoute(auth), members(), list.route);
    const response = await request("POST", "/v1/tasks/bulk", {
      action: "mark_done",
      filter: { status: "open", priority: ["urgent"], tag_id: TAG_ID },
    });
    expect(response.status).toBe(200);
    const url = list.calls[0].url;
    expect(url.searchParams.get("priority")).toBe("in.(urgent)");
    expect(url.searchParams.get("task_tags.tag_id")).toBe(`eq.${TAG_ID}`);
  });
});
