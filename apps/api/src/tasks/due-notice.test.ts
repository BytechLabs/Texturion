/**
 * Task due-date reminders. What matters here is that a person is told once per
 * due date, that finishing or rescheduling the work stops the reminder, and
 * that a reminder can never repeat every quarter hour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { notifyDueTasksJob, TASK_DUE_BATCH } from "./due-notice";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const TASK_ID = "77777777-0000-4000-8000-000000000001";
const ASSIGNEE = "10000000-aaaa-4000-8000-000000000001";
const NOW = new Date("2026-07-25T14:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

function dueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    title: "Replace the outdoor tap at 5 King St",
    assigned_user_id: ASSIGNEE,
    messages: { done_at: null },
    ...overrides,
  };
}

function world(
  options: {
    tasks?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
    stampFails?: boolean;
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/tasks", () => options.tasks ?? [dueTask()]);
  sb.on("PATCH", "/rest/v1/tasks", () =>
    options.stampFails ? new Response("boom", { status: 500 }) : [],
  );
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  return sb;
}

describe("notifyDueTasksJob", () => {
  it("asks only for work that is due, live, and someone's to do", async () => {
    const sb = world();
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const params = sb.find("GET", "/rest/v1/tasks")[0].url.searchParams;
    expect(params.get("due_at")).toBe(`lte.${NOW.toISOString()}`);
    // Reminded already, deleted, or unassigned: none of those is owed a push.
    expect(params.get("due_notified_at")).toBe("is.null");
    expect(params.get("deleted_at")).toBe("is.null");
    expect(params.get("assigned_user_id")).toBe("not.is.null");
    // Completion lives on the promoted message, so a finished job is excluded
    // by the join rather than by a column on the task.
    expect(params.get("messages.done_at")).toBe("is.null");
    expect(params.get("limit")).toBe(String(TASK_DUE_BATCH));
  });

  it("stamps the task before sending, so a crash cannot remind twice", async () => {
    const sb = world();
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const stamps = sb.find("PATCH", "/rest/v1/tasks");
    expect(stamps).toHaveLength(1);
    expect(stamps[0].url.searchParams.get("id")).toBe(`eq.${TASK_ID}`);
    // The guard makes two runs racing the same task settle on one reminder.
    expect(stamps[0].url.searchParams.get("due_notified_at")).toBe("is.null");
  });

  it("reminds the assignee and nobody else", async () => {
    const sb = world();
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const audience = sb
      .find("GET", "/rest/v1/push_subscriptions")[0]
      .url.searchParams.get("user_id");
    expect(audience).toBe(`in.(${ASSIGNEE})`);
  });

  it("respects a member who turned push off", async () => {
    const sb = world({
      prefs: [{ user_id: ASSIGNEE, push_enabled: false }],
    });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    // Still stamped: the reminder was owed and is now spent, not deferred.
    expect(sb.find("PATCH", "/rest/v1/tasks")).toHaveLength(1);
    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });

  it("does nothing at all when nothing is due", async () => {
    const sb = world({ tasks: [] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("PATCH", "/rest/v1/tasks")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/notification_prefs")).toHaveLength(0);
  });

  it("still reminds on a task with no conversation behind it", async () => {
    // A task carries a conversation because it was promoted from a message,
    // but the column is nullable and a null must not cost someone the
    // reminder: the alert falls back to the task list.
    const sb = world({ tasks: [dueTask({ conversation_id: null })] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("PATCH", "/rest/v1/tasks")).toHaveLength(1);
    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(1);
  });

  it("reports a stamp failure rather than swallowing it", async () => {
    const sb = world({ stampFails: true });
    stubFetch(sb.route);

    await expect(notifyDueTasksJob(env, NOW)).rejects.toThrow(
      /task due reminders/,
    );
  });
});
