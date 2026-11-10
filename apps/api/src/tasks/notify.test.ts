/**
 * #689 D: task subscriber notifications.
 *
 * What these pin is who is told and who is not: each kind reaches the people who
 * follow the task, the actor is never one of them, an unfollow holds, a member
 * denied the number is not told, and rapid repeats by one person collapse. The
 * delivery itself is `deliverPush` (own suite), so it is captured here and the
 * payload is read in the clear, which an encrypted wire cannot offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { PushDelivery } from "../notifications/deliver";
import { deliverPush } from "../notifications/deliver";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  notifyPromotedMessageDone,
  notifyTaskChange,
  TASK_NOTIFY_WINDOW_SECONDS,
  taskLink,
  type TaskChange,
} from "./notify";

vi.mock("../notifications/deliver", () => ({
  deliverPush: vi.fn(async () => undefined),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const TASK_ID = "22222222-0000-4000-8000-000000000022";
const CONVERSATION_ID = "11111111-0000-4000-8000-000000000011";
const MESSAGE_ID = "33333333-0000-4000-8000-000000000033";
/** Makes the change. */
const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
/** Followers. */
const SAM = "bbbbbbbb-0000-4000-8000-00000000000b";
const PAT = "dddddddd-0000-4000-8000-00000000000d";
const NUMBER_ID = "99999999-0000-4000-8000-000000000099";
const ORIGIN = "https://app.loonext.com";

beforeEach(() => {
  vi.mocked(deliverPush).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface World {
  /** Active followers of the task. */
  followers?: string[];
  /** Every active member of the company. */
  members?: string[];
  /** The task sits on a thread. */
  conversationId?: string | null;
  /** Members denied the thread's number. */
  deniedOnNumber?: string[];
  prefs?: { user_id: string; push_enabled: boolean }[];
  title?: string | null;
  deleted?: boolean;
  /** Recipients the claim has already handed out inside the window. */
  claimed?: Set<string>;
  claimFails?: boolean;
}

function world(options: World = {}) {
  const sb = supabaseStub(env);
  const members = options.members ?? [ACTOR, SAM, PAT];
  const conversationId = options.conversationId ?? null;
  const claimed = options.claimed ?? new Set<string>();

  sb.on("GET", "/rest/v1/tasks", () => [
    {
      id: TASK_ID,
      title: options.title === undefined ? "Replace the outdoor tap at 5 King St" : options.title,
      conversation_id: conversationId,
      deleted_at: options.deleted ? "2026-11-10T00:00:00Z" : null,
    },
  ]);
  sb.on("GET", "/rest/v1/task_subscribers", () =>
    (options.followers ?? [ACTOR, SAM, PAT]).map((user_id) => ({ user_id })),
  );
  sb.on("GET", "/rest/v1/company_members", (call) => {
    const select = call.url.searchParams.get("select") ?? "";
    if (select.includes("role")) {
      return members.map((user_id) => ({ user_id, role: "member" }));
    }
    return members.map((user_id) => ({ user_id }));
  });
  sb.on("GET", "/rest/v1/conversations", () => [
    { phone_number_id: options.deniedOnNumber ? NUMBER_ID : null },
  ]);
  sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
    members.map((user_id) => ({
      user_id,
      role: "member",
      level: options.deniedOnNumber?.includes(user_id) ? "none" : "text",
    })),
  );
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Dana Reyes" }]);
  // The same contract as task_notify_claim: only recipients not already holding
  // an open window win, and winning opens one.
  sb.on("POST", "/rest/v1/rpc/task_notify_claim", (call) => {
    if (options.claimFails) {
      return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    }
    const wanted = (call.body as { p_recipients: string[] }).p_recipients;
    const won = wanted.filter((id) => !claimed.has(id));
    for (const id of won) claimed.add(id);
    return won;
  });
  stubFetch(sb.route);
  return sb;
}

async function run(change: Partial<TaskChange> & { kind: TaskChange["kind"] }) {
  await notifyTaskChange(
    env,
    { companyId: COMPANY_ID, taskId: TASK_ID, actorUserId: ACTOR, ...change },
    getDb(env),
  );
}

function sent(): PushDelivery[] {
  return vi.mocked(deliverPush).mock.calls.map((call) => call[2]);
}

describe("each kind of change reaches the people following the task", () => {
  it("someone else finishing a task tells the others, in the actor's words", async () => {
    world();
    await run({ kind: "completed" });

    expect(sent()).toHaveLength(1);
    const delivery = sent()[0];
    expect(delivery.category).toBe("tasks");
    expect(delivery.userIds.sort()).toEqual([PAT, SAM].sort());
    expect(delivery.web("en")).toMatchObject({
      title: "Dana Reyes finished a task",
      body: "Replace the outdoor tap at 5 King St",
      url: `${ORIGIN}/tasks/${TASK_ID}`,
    });
    expect(delivery.web("fr-CA").title).toBe("Dana Reyes a terminé une tâche");
    expect(delivery.native?.("en").kind).toBe("task_update");
  });

  it("reopening says so", async () => {
    world();
    await run({ kind: "reopened" });
    expect(sent()[0].web("en").title).toBe("Dana Reyes reopened a task");
  });

  it("a changed time says so, without a value that could already be stale", async () => {
    world();
    await run({ kind: "due_changed" });
    const payload = sent()[0].web("en");
    expect(payload.title).toBe("Dana Reyes changed a task's time");
    expect(payload.body).toBe("Replace the outdoor tap at 5 King St");
  });

  it("a new comment shows the comment to everyone but the people it names", async () => {
    world();
    await run({ kind: "comment", commentBody: "Parts arrive Friday", mentionedUserIds: [SAM] });

    expect(sent()).toHaveLength(1);
    expect(sent()[0].userIds).toEqual([PAT]);
    expect(sent()[0].web("en")).toMatchObject({
      title: "Dana Reyes commented on a task",
      body: "Parts arrive Friday",
    });
  });

  it("a mention goes to the named person under the mentions volume control", async () => {
    world();
    await run({
      kind: "mentioned",
      commentBody: "Sam, can you take this?",
      mentionedUserIds: [SAM],
    });

    expect(sent()).toHaveLength(1);
    expect(sent()[0].category).toBe("mentions");
    expect(sent()[0].userIds).toEqual([SAM]);
    expect(sent()[0].web("en").title).toBe("Dana Reyes mentioned you on a task");
  });

  it("taking someone off a task tells that person, and nobody else", async () => {
    world();
    await run({ kind: "unassigned", previousAssigneeId: SAM });

    expect(sent()).toHaveLength(1);
    expect(sent()[0].userIds).toEqual([SAM]);
    expect(sent()[0].web("en").title).toBe("Dana Reyes took you off a task");
  });

  it("a task on a thread opens over its customer, with the job drawer", async () => {
    world({ conversationId: CONVERSATION_ID });
    await run({ kind: "completed" });
    expect(sent()[0].web("en").url).toBe(
      `${ORIGIN}/inbox/${CONVERSATION_ID}?task=${TASK_ID}`,
    );
    expect(taskLink(ORIGIN, { id: TASK_ID, conversation_id: null })).toBe(
      `${ORIGIN}/tasks/${TASK_ID}`,
    );
  });

  it("a finished message-anchored task is found through its message", async () => {
    world();
    await notifyPromotedMessageDone(
      env,
      { companyId: COMPANY_ID, messageId: MESSAGE_ID, actorUserId: ACTOR, done: true },
      getDb(env),
    );
    expect(sent()).toHaveLength(1);
    expect(sent()[0].web("en").title).toBe("Dana Reyes finished a task");
  });
});

describe("the person who made the change is never told about it", () => {
  const kinds: TaskChange["kind"][] = [
    "unassigned",
    "due_changed",
    "completed",
    "reopened",
    "comment",
    "mentioned",
  ];

  for (const kind of kinds) {
    it(`${kind}: the actor follows the task and is still left out`, async () => {
      world({ followers: [ACTOR] });
      await run({
        kind,
        previousAssigneeId: ACTOR,
        mentionedUserIds: [ACTOR],
        commentBody: "note to self",
      });
      expect(sent()).toHaveLength(0);
    });
  }

  it("a comment that names the actor does not tell them either", async () => {
    world({ followers: [ACTOR, SAM] });
    await run({ kind: "comment", commentBody: "x", mentionedUserIds: [ACTOR] });
    expect(sent()[0].userIds).toEqual([SAM]);
  });
});

describe("only people who still follow it are told", () => {
  it("an unfollowed task stays quiet for the person who unfollowed", async () => {
    // The query asks for unsubscribed_at IS NULL; the stub answers as the table
    // would, with the unfollower's row filtered out.
    const sb = world({ followers: [SAM] });
    await run({ kind: "completed" });

    expect(sent()[0].userIds).toEqual([SAM]);
    const query = sb.find("GET", "/rest/v1/task_subscribers")[0];
    expect(query.url.searchParams.get("unsubscribed_at")).toBe("is.null");
  });

  it("nobody following means no push and no claim", async () => {
    const sb = world({ followers: [ACTOR] });
    await run({ kind: "completed" });
    expect(sent()).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/task_notify_claim")).toHaveLength(0);
  });

  it("a former assignee who unfollowed is not told they were taken off", async () => {
    world({ followers: [PAT] });
    await run({ kind: "unassigned", previousAssigneeId: SAM });
    expect(sent()).toHaveLength(0);
  });

  it("a deactivated member is not told", async () => {
    world({ members: [ACTOR, SAM] });
    await run({ kind: "completed" });
    expect(sent()[0].userIds).toEqual([SAM]);
  });

  it("a member who turned push off is not told", async () => {
    world({ prefs: [{ user_id: SAM, push_enabled: false }] });
    await run({ kind: "completed" });
    expect(sent()[0].userIds).toEqual([PAT]);
  });

  it("a deleted task says nothing", async () => {
    world({ deleted: true });
    await run({ kind: "completed" });
    expect(sent()).toHaveLength(0);
  });
});

describe("a number somebody is denied does not leak the task", () => {
  it("is not pushed to a member denied the thread's number", async () => {
    world({ conversationId: CONVERSATION_ID, deniedOnNumber: [SAM] });
    await run({ kind: "completed" });
    expect(sent()[0].userIds).toEqual([PAT]);
  });

  it("sends nothing when every follower is denied", async () => {
    world({ conversationId: CONVERSATION_ID, deniedOnNumber: [SAM, PAT] });
    await run({ kind: "comment", commentBody: "secret" });
    expect(sent()).toHaveLength(0);
  });

  it("keeps the task words off a lock screen when the workspace turns content off", () => {
    // The wording that survives is ours; the title and the comment are withheld
    // by deliverPush from the `withheld` this call declares.
    world();
    return run({ kind: "comment", commentBody: "Gate code 4417" }).then(() => {
      const delivery = sent()[0];
      expect(delivery.content).toMatchObject({ written: "people", companyId: COMPANY_ID });
      if (delivery.content.written !== "people") throw new Error("unreachable");
      expect(delivery.content.withheld("en")).toEqual({ body: "Open the app to see it" });
      expect(delivery.content.withheld("fr-CA")).toEqual({
        body: "Ouvrez l'application pour la voir",
      });
    });
  });
});

describe("rapid edits by one person collapse into one push", () => {
  it("the second identical edit inside the window pushes nobody", async () => {
    const sb = world();
    await run({ kind: "due_changed" });
    await run({ kind: "due_changed" });

    expect(sent()).toHaveLength(1);
    const claim = sb.find("POST", "/rest/v1/rpc/task_notify_claim");
    expect(claim).toHaveLength(2);
    expect(claim[0].body).toMatchObject({
      p_task_id: TASK_ID,
      p_actor_user_id: ACTOR,
      p_kind: "due_changed",
      p_window_seconds: TASK_NOTIFY_WINDOW_SECONDS,
    });
    expect(TASK_NOTIFY_WINDOW_SECONDS).toBe(60);
  });

  it("only the recipients who lost the window are skipped", async () => {
    world({ claimed: new Set([SAM]) });
    await run({ kind: "completed" });
    expect(sent()[0].userIds).toEqual([PAT]);
  });

  it("the claim runs after every filter, so a denied member never spends a window", async () => {
    const sb = world({ conversationId: CONVERSATION_ID, deniedOnNumber: [SAM] });
    await run({ kind: "completed" });
    const claim = sb.find("POST", "/rest/v1/rpc/task_notify_claim")[0];
    expect((claim.body as { p_recipients: string[] }).p_recipients).toEqual([PAT]);
  });

  it("a claim that fails is reported, not swallowed into a silent send", async () => {
    world({ claimFails: true });
    await expect(run({ kind: "completed" })).rejects.toThrow(/task_notify_claim failed/);
    expect(sent()).toHaveLength(0);
  });
});
