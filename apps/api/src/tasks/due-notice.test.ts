/**
 * Task due-date reminders. What matters here is that a person is told once per
 * due date, that finishing or rescheduling the work stops the reminder, and
 * that a reminder can never repeat every quarter hour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  dueNoticeBody,
  dueNoticeLink,
  notifyDueTasksJob,
  TASK_DUE_BATCH,
  TASK_DUE_LEAD_MINUTES,
  TASK_DUE_MAX_LATE_MINUTES,
} from "./due-notice";
import { TASK_DUE_COPY } from "./due-notice-copy";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const TASK_ID = "77777777-0000-4000-8000-000000000001";
const ASSIGNEE = "10000000-aaaa-4000-8000-000000000001";
const SECOND = "10000000-aaaa-4000-8000-000000000002";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
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
    due_at: NOW.toISOString(),
    assigned_user_id: ASSIGNEE,
    ...overrides,
  };
}

function world(
  options: {
    tasks?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
    /** Active members of the task's company; [] means the assignee was removed. */
    members?: Record<string, unknown>[];
    /** Another run claimed the task first. */
    claimLost?: boolean;
    stampFails?: boolean;
    /**
     * Registered HERE rather than by a later `sb.on`. The harness is
     * first-match-wins, so re-registering a path this helper already claimed is
     * a stub that silently never runs — and a push suite whose device list is
     * always empty passes while asserting nothing.
     */
    devices?: Record<string, unknown>[];
    /** The task's thread is on a number the assignee is denied (#106). */
    deniedOnNumber?: boolean;
    /** Everyone on the task (#689 C). Defaults to the one assignee. */
    crew?: string[];
    /** The people the thread's number is denied to, out of the crew. */
    denied?: string[];
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/tasks", () => options.tasks ?? [dueTask()]);
  // The claim returns the row it changed; an empty array means another run
  // already owns this task.
  sb.on("PATCH", "/rest/v1/tasks", () =>
    options.stampFails
      ? new Response("boom", { status: 500 })
      : options.claimLost
        ? []
        : [{ id: TASK_ID }],
  );
  sb.on("GET", "/rest/v1/task_assignees", () =>
    (options.crew ?? [ASSIGNEE]).map((user_id) => ({ task_id: TASK_ID, user_id })),
  );
  sb.on("GET", "/rest/v1/company_members", (call) => {
    const all = options.members ?? [{ user_id: ASSIGNEE, role: "member" }];
    // The notifier asks about one person at a time.
    const asked = call.url.searchParams.get("user_id")?.replace(/^eq./, "");
    return asked ? all.filter((row) => row.user_id === asked) : all;
  });
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      phone_number_id:
        options.deniedOnNumber || (options.denied ?? []).length > 0 ? NUMBER_ID : null,
    },
  ]);
  sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
    (options.crew ?? [ASSIGNEE]).map((user_id) => ({
      user_id,
      role: "member",
      level:
        options.deniedOnNumber || (options.denied ?? []).includes(user_id) ? "none" : "text",
    })),
  );
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => options.devices ?? []);
  return sb;
}

describe("dueNoticeBody", () => {
  const at = (minutesFromNow: number) =>
    new Date(NOW.getTime() + minutesFromNow * 60_000);

  it("counts down to a deadline that has not passed", () => {
    expect(dueNoticeBody(at(25), NOW, "en")).toBe("Due in 25 min");
    expect(dueNoticeBody(at(1), NOW, "en")).toBe("Due in 1 min");
  });

  it("says so plainly at the deadline", () => {
    expect(dueNoticeBody(at(0), NOW, "en")).toBe("Due now");
  });

  it("never tells someone that overdue work is still ahead of them", () => {
    // The first run after an outage, or a bulk import of past-due work, is
    // where this matters: "due in 30 min" for last Tuesday's job is a lie.
    expect(dueNoticeBody(at(-20), NOW, "en")).toBe("20 min overdue");
    expect(dueNoticeBody(at(-90), NOW, "en")).toBe("2 hours overdue");
    expect(dueNoticeBody(at(-60), NOW, "en")).toBe("1 hour overdue");
    expect(dueNoticeBody(at(-60 * 24 * 3), NOW, "en")).toBe("3 days overdue");
  });

  it("#228: reads the reader's language, and agrees with itself in both", () => {
    // The branch arithmetic is what this function owns; the sentences belong to
    // the copy table. So what is worth pinning is that EVERY branch is
    // translated — an untranslated one would be a single English line inside an
    // otherwise French notification, which is the failure #228 exists to stop.
    expect(dueNoticeBody(at(25), NOW, "fr-CA")).toBe("Échéance dans 25 min");
    expect(dueNoticeBody(at(0), NOW, "fr-CA")).toBe("Échéance maintenant");
    expect(dueNoticeBody(at(-20), NOW, "fr-CA")).toBe("20 min de retard");
    // The plural noun is picked inline in both languages, so both need proving.
    expect(dueNoticeBody(at(-60), NOW, "fr-CA")).toBe("1 heure de retard");
    expect(dueNoticeBody(at(-90), NOW, "fr-CA")).toBe("2 heures de retard");
    expect(dueNoticeBody(at(-60 * 24 * 3), NOW, "fr-CA")).toBe("3 jours de retard");
  });
});

describe("dueNoticeLink", () => {
  it("opens the job over the customer it belongs to", () => {
    // The drawer is shell-mounted and `?task=` drives it, so one link carries
    // the address and checklist AND the thread they are about.
    expect(
      dueNoticeLink("https://app.example.com", {
        id: TASK_ID,
        conversation_id: CONVERSATION_ID,
      }),
    ).toBe(
      `https://app.example.com/inbox/${CONVERSATION_ID}?task=${TASK_ID}`,
    );
  });

  it("opens the task's own page when no conversation is behind it", () => {
    // That route renders the same panel from cold, which is the state a tap on
    // a notification arrives in.
    expect(
      dueNoticeLink("https://app.example.com", {
        id: TASK_ID,
        conversation_id: null,
      }),
    ).toBe(`https://app.example.com/tasks/${TASK_ID}`);
  });
});

describe("notifyDueTasksJob", () => {
  it("asks only for work that is due, live, and someone's to do", async () => {
    const sb = world();
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const params = sb.find("GET", "/rest/v1/tasks")[0].url.searchParams;
    // The window reaches AHEAD of now: a reminder that arrives on the deadline
    // has already missed it.
    expect(params.get("due_at")).toBe(
      `lte.${new Date(NOW.getTime() + TASK_DUE_LEAD_MINUTES * 60_000).toISOString()}`,
    );
    // Reminded already, deleted, or unassigned: none of those is owed a push.
    expect(params.get("due_notified_at")).toBe("is.null");
    expect(params.get("deleted_at")).toBe("is.null");
    expect(params.get("assigned_user_id")).toBe("not.is.null");
    // Completion is the task's effective done state (the promoted message's, or
    // the task's own for a call-anchored job), so a finished job is excluded by
    // the computed column. It must NOT be an inner embed of messages: that
    // would drop every call-anchored job and never remind anyone of it.
    expect(params.get("task_done_at")).toBe("is.null");
    expect(params.get("select")).not.toContain("messages");
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

  it("reminds every assignee, in one push (#689 C)", async () => {
    const sb = world({
      crew: [ASSIGNEE, SECOND],
      members: [
        { user_id: ASSIGNEE, role: "member" },
        { user_id: SECOND, role: "member" },
      ],
    });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const audience = sb
      .find("GET", "/rest/v1/push_subscriptions")[0]
      .url.searchParams.get("user_id");
    expect(audience).toBe(`in.(${ASSIGNEE},${SECOND})`);
    // One claim for the task, not one per person.
    expect(sb.find("PATCH", "/rest/v1/tasks")).toHaveLength(1);
  });

  it("leaves out an assignee denied the number, and a member who turned push off (#689 C)", async () => {
    const sb = world({
      crew: [ASSIGNEE, SECOND],
      denied: [SECOND],
      members: [
        { user_id: ASSIGNEE, role: "member" },
        { user_id: SECOND, role: "member" },
      ],
    });
    stubFetch(sb.route);
    await notifyDueTasksJob(env, NOW);
    expect(
      sb.find("GET", "/rest/v1/push_subscriptions")[0].url.searchParams.get("user_id"),
    ).toBe(`in.(${ASSIGNEE})`);

    const quiet = world({
      crew: [ASSIGNEE, SECOND],
      members: [
        { user_id: ASSIGNEE, role: "member" },
        { user_id: SECOND, role: "member" },
      ],
      prefs: [{ user_id: ASSIGNEE, push_enabled: false }],
    });
    stubFetch(quiet.route);
    await notifyDueTasksJob(env, NOW);
    expect(
      quiet.find("GET", "/rest/v1/push_subscriptions")[0].url.searchParams.get("user_id"),
    ).toBe(`in.(${SECOND})`);
  });

  it("never reminds someone who was removed from the workspace", async () => {
    // Deactivation leaves the assignment in place, and push registrations are
    // per user with no company column, so without this check a removed member
    // keeps getting that workspace's reminders. Task titles are seeded from the
    // customer's own message, so those alerts carry customer detail out of a
    // workspace the reader can no longer open.
    const sb = world({ members: [] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/notification_prefs")).toHaveLength(0);
  });

  it("never reminds someone denied the number the job's thread is on", async () => {
    // The title is a member's own words and often a customer's address, so a
    // reminder must not carry it to someone the thread is now hidden from.
    const sb = world({ deniedOnNumber: true });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });

  it("asks for the assignee's membership scoped to the task's company", async () => {
    const sb = world({ tasks: [dueTask({ conversation_id: null })] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    const params = sb.find("GET", "/rest/v1/company_members")[0].url.searchParams;
    expect(params.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(params.get("user_id")).toBe(`eq.${ASSIGNEE}`);
    expect(params.get("deactivated_at")).toBe("is.null");
  });

  it("claims long-overdue work without waking anyone for it", async () => {
    // A deadline from last month is not worth a push, and the first run after
    // any gap (a new column with no history stamped, a restored backup, a bulk
    // import of dated work) would otherwise fire one alert per historical
    // task. Stamping it anyway is what empties the queue for good.
    const longAgo = new Date(
      NOW.getTime() - (TASK_DUE_MAX_LATE_MINUTES + 60) * 60_000,
    ).toISOString();
    const sb = world({ tasks: [dueTask({ due_at: longAgo })] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("PATCH", "/rest/v1/tasks")).toHaveLength(1);
    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });

  it("still reminds about work that came due during an outage", async () => {
    // The scan has no lower bound on purpose: a few hours late is exactly when
    // the reminder is still worth having.
    const hoursLate = new Date(NOW.getTime() - 4 * 60 * 60_000).toISOString();
    const sb = world({ tasks: [dueTask({ due_at: hoursLate })] });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(1);
  });

  it("sends nothing when another run claimed the task first", async () => {
    // Two runs can overlap when a batch is still going as the next quarter
    // hour fires. The claim is what settles it, so the row count has to be
    // read: an update that changed nothing means someone else owns this one.
    const sb = world({ claimLost: true });
    stubFetch(sb.route);

    await notifyDueTasksJob(env, NOW);

    expect(sb.find("GET", "/rest/v1/company_members")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
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

  it("#228: a member's own title rides through, and OUR fallback is translated", async () => {
    // The two halves of this reminder have different owners. "Replace the
    // outdoor tap at 5 King St" is a member's words and must arrive exactly as
    // typed on a French phone as on an English one; the body underneath it is
    // ours and must not. One crew, two phones, so the difference is visible in
    // a single fan-out rather than inferred across two tests. (The untitled
    // task, where the title is ours too, is the test below.)
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world({
      tasks: [dueTask({ due_at: NOW.toISOString() })],
      devices: [
        {
          id: "50000000-aaaa-4000-8000-000000000001",
          user_id: ASSIGNEE,
          platform: "android",
          token: "tok-fr",
          locale: "fr-CA",
        },
        {
          id: "50000000-aaaa-4000-8000-000000000002",
          user_id: ASSIGNEE,
          platform: "android",
          token: "tok-en",
          locale: null,
        },
      ],
    });
    stubFetch(sb.route, ...service.routes);

    await notifyDueTasksJob(fcmEnv(account), NOW);

    const dataFor = (token: string) =>
      service.sends.find((send) => (send.message as { token: string }).token === token)
        ?.message.data as Record<string, string>;

    // Theirs, untouched, in both.
    expect(dataFor("tok-fr").title).toBe("Replace the outdoor tap at 5 King St");
    expect(dataFor("tok-en").title).toBe("Replace the outdoor tap at 5 King St");
    // Ours, and only ours, changes language.
    expect(dataFor("tok-fr").body).toBe("Échéance maintenant");
    expect(dataFor("tok-en").body).toBe("Due now");
  });

  it("#228: an untitled task is titled by us, so that title has a language", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world({
      tasks: [dueTask({ title: null })],
      devices: [
        {
          id: "50000000-aaaa-4000-8000-000000000003",
          user_id: ASSIGNEE,
          platform: "android",
          token: "tok-fr",
          locale: "fr-CA",
        },
      ],
    });
    stubFetch(sb.route, ...service.routes);

    await notifyDueTasksJob(fcmEnv(account), NOW);

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.title).toBe("Une tâche");
  });
});

describe("TASK_DUE_COPY", () => {
  it("#228/#430: pins the withheld title, which has no test at the wire", () => {
    // The #430 stand-in is chosen inside deliver.ts's withholding path, whose
    // own suite is the only place this English was ever asserted. Pin it here
    // too: the sentence belongs to this feature, and losing the assertion with
    // a refactor of somebody else's file is how an English lock screen comes
    // back on a French phone.
    expect(TASK_DUE_COPY.en.withheldTitle).toBe("A task is due");
    expect(TASK_DUE_COPY["fr-CA"].withheldTitle).toBe("Une tâche arrive à échéance");
    expect(TASK_DUE_COPY.en.fallbackTitle).toBe("A task");
  });
});
