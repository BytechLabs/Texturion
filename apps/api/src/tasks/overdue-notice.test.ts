/**
 * #689 D: the overdue alert. Once, to the assignee, a grace period after the due
 * time, never for work that is done, re-armed by a new due time, and never for a
 * task on a number the assignee is denied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverPush } from "../notifications/deliver";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  notifyOverdueTasksJob,
  TASK_OVERDUE_BATCH,
  TASK_OVERDUE_GRACE_MINUTES,
  TASK_OVERDUE_MAX_LATE_MINUTES,
} from "./overdue-notice";

vi.mock("../notifications/deliver", () => ({
  deliverPush: vi.fn(async () => undefined),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const TASK_ID = "77777777-0000-4000-8000-000000000001";
const ASSIGNEE = "10000000-aaaa-4000-8000-000000000001";
const SECOND = "10000000-aaaa-4000-8000-000000000002";
const NUMBER_ID = "99999999-0000-4000-8000-000000000099";
const NOW = new Date("2026-11-10T14:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

beforeEach(() => {
  vi.mocked(deliverPush).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function overdueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    conversation_id: null,
    title: "Replace the outdoor tap at 5 King St",
    due_at: minutesAgo(20),
    assigned_user_id: ASSIGNEE,
    ...overrides,
  };
}

function world(
  options: {
    tasks?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
    members?: Record<string, unknown>[];
    claimLost?: boolean;
    deniedOnNumber?: boolean;
    /** Everyone on the task (#689 C). Defaults to the one assignee. */
    crew?: string[];
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/tasks", () => options.tasks ?? [overdueTask()]);
  sb.on("PATCH", "/rest/v1/tasks", () => (options.claimLost ? [] : [{ id: TASK_ID }]));
  sb.on("GET", "/rest/v1/task_assignees", () =>
    (options.crew ?? [ASSIGNEE]).map((user_id) => ({ task_id: TASK_ID, user_id })),
  );
  sb.on("GET", "/rest/v1/company_members", (call) => {
    const all = options.members ?? [{ user_id: ASSIGNEE, role: "member" }];
    // The notifier asks about one person at a time.
    const asked = call.url.searchParams.get("user_id")?.replace(/^eq./, "");
    const roster = asked ? all.filter((row) => row.user_id === asked) : all;
    return call.url.searchParams.get("select")?.includes("role")
      ? roster
      : roster.map(({ user_id }) => ({ user_id }));
  });
  sb.on("GET", "/rest/v1/conversations", () => [
    { phone_number_id: options.deniedOnNumber ? NUMBER_ID : null },
  ]);
  sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
    (options.crew ?? [ASSIGNEE]).map((user_id) => ({
      user_id,
      role: "member",
      level: options.deniedOnNumber ? "none" : "text",
    })),
  );
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  stubFetch(sb.route);
  return sb;
}

const sent = () => vi.mocked(deliverPush).mock.calls.map((call) => call[2]);

describe("the overdue alert", () => {
  it("tells the assignee how late the job is, under the Tasks category", async () => {
    world();
    await notifyOverdueTasksJob(env, NOW);

    expect(sent()).toHaveLength(1);
    const delivery = sent()[0];
    expect(delivery.category).toBe("tasks");
    expect(delivery.userIds).toEqual([ASSIGNEE]);
    expect(delivery.web("en")).toMatchObject({
      title: "Replace the outdoor tap at 5 King St",
      body: "20 min overdue",
      url: `https://app.loonext.com/tasks/${TASK_ID}`,
    });
    expect(delivery.web("fr-CA").body).toBe("20 min de retard");
    expect(delivery.native?.("en").kind).toBe("task_due");
    // The same identity as the due-soon alert, so it replaces it on the lock screen.
    expect(delivery.collapseKey).toBe(`task:${TASK_ID}`);
  });

  it("scans only the window between the grace period and the staleness ceiling", async () => {
    const sb = world();
    await notifyOverdueTasksJob(env, NOW);

    const scan = sb.find("GET", "/rest/v1/tasks")[0].url.searchParams;
    expect(scan.get("overdue_notified_at")).toBe("is.null");
    expect(scan.get("task_done_at")).toBe("is.null");
    expect(scan.get("deleted_at")).toBe("is.null");
    expect(scan.getAll("due_at")).toEqual([
      `lte.${minutesAgo(TASK_OVERDUE_GRACE_MINUTES)}`,
      `gte.${minutesAgo(TASK_OVERDUE_MAX_LATE_MINUTES)}`,
    ]);
    expect(scan.get("limit")).toBe(String(TASK_OVERDUE_BATCH));
    expect(TASK_OVERDUE_GRACE_MINUTES).toBe(15);
  });

  it("claims the task before sending, and a lost claim sends nothing", async () => {
    const sb = world({ claimLost: true });
    await notifyOverdueTasksJob(env, NOW);

    const claim = sb.find("PATCH", "/rest/v1/tasks")[0];
    expect(claim.url.searchParams.get("overdue_notified_at")).toBe("is.null");
    expect(sent()).toHaveLength(0);
  });

  it("tells every assignee, in one push (#689 C)", async () => {
    world({
      crew: [ASSIGNEE, SECOND],
      members: [
        { user_id: ASSIGNEE, role: "member" },
        { user_id: SECOND, role: "member" },
      ],
    });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ userIds: [ASSIGNEE, SECOND] });
  });

  it("leaves out an assignee who left or turned push off, and tells the rest (#689 C)", async () => {
    world({
      crew: [ASSIGNEE, SECOND],
      members: [{ user_id: SECOND, role: "member" }],
    });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ userIds: [SECOND] });

    vi.mocked(deliverPush).mockClear();
    world({
      crew: [ASSIGNEE, SECOND],
      members: [
        { user_id: ASSIGNEE, role: "member" },
        { user_id: SECOND, role: "member" },
      ],
      prefs: [{ user_id: ASSIGNEE, push_enabled: false }],
    });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()[0]).toMatchObject({ userIds: [SECOND] });
  });

  it("says nothing to an assignee who left the crew", async () => {
    world({ members: [] });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(0);
  });

  it("says nothing to an assignee who turned push off", async () => {
    world({ prefs: [{ user_id: ASSIGNEE, push_enabled: false }] });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(0);
  });

  it("does not leak a task on a number the assignee is denied", async () => {
    world({
      tasks: [overdueTask({ conversation_id: CONVERSATION_ID })],
      deniedOnNumber: true,
    });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(0);
  });

  it("opens a task on a thread over its customer", async () => {
    world({ tasks: [overdueTask({ conversation_id: CONVERSATION_ID })] });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()[0].web("en").url).toBe(
      `https://app.loonext.com/inbox/${CONVERSATION_ID}?task=${TASK_ID}`,
    );
  });

  it("withholds the title, and keeps the lateness, when content is turned off", async () => {
    world();
    await notifyOverdueTasksJob(env, NOW);
    const content = sent()[0].content;
    if (content.written !== "people") throw new Error("unreachable");
    expect(content.withheld("en")).toEqual({ title: "A task is overdue" });
    expect(content.withheld("fr-CA")).toEqual({ title: "Une tâche est en retard" });
  });

  it("does nothing on a quiet scan", async () => {
    world({ tasks: [] });
    await notifyOverdueTasksJob(env, NOW);
    expect(sent()).toHaveLength(0);
  });
});
