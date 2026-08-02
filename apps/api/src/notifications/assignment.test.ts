/**
 * #515 — being handed work has to reach the phone.
 *
 * The bell already knew about assignment (the D24 read-model unions
 * assigned-to-me and task-assigned-to-me), so what these pin is the part that
 * was missing: the one channel that reaches somebody who is NOT looking at the
 * app. The interesting cases are all the ones where it must stay quiet — a
 * self-assignment, a member who turned push off, a member who cannot see the
 * number, and a bulk hand-off that must never become one push per thread.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { assignmentAlert, notifyAssigned } from "./assignment";
import { encodeBase64Url } from "./webpush";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
/** The assigner. */
const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
/** The person handed the work. */
const ASSIGNEE = "bbbbbbbb-0000-4000-8000-00000000000b";
const CONVERSATION_ID = "11111111-0000-4000-8000-000000000011";
const TASK_ID = "22222222-0000-4000-8000-000000000022";
const PUSH_ORIGIN = "https://push.example.net";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function subscriptionRow(userId: string) {
  const uaKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer,
  );
  return {
    id: `sub-${userId}`,
    user_id: userId,
    endpoint: `${PUSH_ORIGIN}/send/${userId}`,
    p256dh: encodeBase64Url(uaPublic),
    auth: encodeBase64Url(authSecret),
  };
}

/**
 * A workspace where the assignee is an active member who can see the number,
 * has push on, and has one live subscription. Every test narrows from here, so
 * a silence is always attributable to the one thing that test changed.
 */
async function world(
  overrides: {
    members?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
    conversation?: Record<string, unknown>[];
    contact?: Record<string, unknown>[];
    pushIncludeContent?: boolean;
  } = {},
) {
  const sb = supabaseStub(env);
  const sub = await subscriptionRow(ASSIGNEE);
  const sends: { payload: string }[] = [];

  sb.on("GET", "/rest/v1/company_members", (call) => {
    const roster = overrides.members ?? [
      { user_id: ACTOR, role: "admin" },
      { user_id: ASSIGNEE, role: "member" },
    ];
    // The membership branch asks about ONE person (`.eq("user_id", …)`), the
    // audience branch asks for the whole roster. A stub that ignored the filter
    // would answer "yes, they're a member" for anybody, which is precisely the
    // check under test.
    const filter = call.url.searchParams.get("user_id");
    if (!filter) return roster;
    const wanted = filter.replace(/^eq\./, "");
    return roster.filter((row) => row.user_id === wanted);
  });
  sb.on("GET", "/rest/v1/conversations", (call) => {
    // Two distinct reads hit this table: the phone_number_id access read and
    // the embedded contact read. The select tells them apart.
    const select = call.url.searchParams.get("select") ?? "";
    if (select.includes("contacts")) {
      return (
        overrides.contact ?? [{ contacts: { name: "Dana Reyes", phone_e164: "+15550100" } }]
      );
    }
    return overrides.conversation ?? [{ phone_number_id: null }];
  });
  sb.on("GET", "/rest/v1/notification_prefs", () => overrides.prefs ?? []);
  sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Sam Ortiz" }]);
  sb.on("GET", "/rest/v1/companies", () => ({
    push_include_content: overrides.pushIncludeContent ?? true,
  }));
  sb.on("GET", "/rest/v1/push_subscriptions", () => [sub]);

  const push: FetchRoute = async (url, request) => {
    if (url.origin !== PUSH_ORIGIN) return undefined;
    sends.push({ payload: await request.clone().text() });
    return new Response(null, { status: 201 });
  };
  return { sb, sends, routes: [sb.route, push] as FetchRoute[] };
}

const ORIGIN = "https://app.loonext.com";
const BASE = { companyId: COMPANY_ID, actorUserId: ACTOR, assigneeUserId: ASSIGNEE };

describe("what the alert actually says", () => {
  it("leads with what happened, then who it is about (#414)", () => {
    // A phone on a bedside table shows one line, and "you have been given a
    // job" is the part that decides whether it is picked up now.
    const alert = assignmentAlert(
      ORIGIN,
      { kind: "conversation", conversationId: CONVERSATION_ID, ...BASE },
      "Sam Ortiz",
      "Dana Reyes",
    );

    expect(alert?.title).toBe("Sam Ortiz assigned you a conversation");
    expect(alert?.body).toBe("Dana Reyes");
    expect(alert?.url).toBe(`${ORIGIN}/inbox/${CONVERSATION_ID}`);
    expect(alert?.nativeKind).toBe("conversation_assigned");
  });

  it("withholds the person's words, never the instruction (#430)", () => {
    // The contact's name and a member-typed task title are both somebody's
    // words; our own sentence is not. What survives still says you were given
    // work and still deep-links to it.
    const conversation = assignmentAlert(
      ORIGIN,
      { kind: "conversation", conversationId: CONVERSATION_ID, ...BASE },
      "Sam Ortiz",
      "Dana Reyes",
    );
    const task = assignmentAlert(
      ORIGIN,
      { kind: "task", taskId: TASK_ID, title: "42 Elm, gate code 4417", conversationId: null, ...BASE },
      "Sam Ortiz",
      null,
    );

    expect(conversation?.written).toBe("people");
    expect(conversation?.withheld).not.toHaveProperty("title");
    expect(task?.written).toBe("people");
    expect(task?.withheld).toEqual({ body: "Open the app to see it" });
  });

  it("opens a task over its own thread, and its own page when it has none", () => {
    const linked = assignmentAlert(
      ORIGIN,
      { kind: "task", taskId: TASK_ID, title: "Re-pipe", conversationId: CONVERSATION_ID, ...BASE },
      "Sam Ortiz",
      null,
    );
    const standalone = assignmentAlert(
      ORIGIN,
      { kind: "task", taskId: TASK_ID, title: "Re-pipe", conversationId: null, ...BASE },
      "Sam Ortiz",
      null,
    );

    expect(linked?.url).toBe(`${ORIGIN}/inbox/${CONVERSATION_ID}?task=${TASK_ID}`);
    expect(standalone?.url).toBe(`${ORIGIN}/tasks/${TASK_ID}`);
  });

  it("counts the batch instead of naming it, and carries no customer content", () => {
    const many = assignmentAlert(
      ORIGIN,
      { kind: "conversation_bulk", count: 14, ...BASE },
      "Sam Ortiz",
      null,
    );
    const one = assignmentAlert(
      ORIGIN,
      { kind: "conversation_bulk", count: 1, ...BASE },
      "Sam Ortiz",
      null,
    );

    expect(many?.title).toBe("Sam Ortiz assigned you 14 conversations");
    expect(one?.title).toBe("Sam Ortiz assigned you 1 conversation");
    // Nothing a customer wrote is in here, so #430 has nothing to withhold.
    expect(many?.written).toBe("us");
    expect(many?.url).toBe(`${ORIGIN}/inbox`);
  });

  it("collapses per thing, so a re-assignment replaces rather than stacks", () => {
    const first = assignmentAlert(
      ORIGIN,
      { kind: "conversation", conversationId: CONVERSATION_ID, ...BASE },
      "Sam Ortiz",
      "Dana Reyes",
    );
    const again = assignmentAlert(
      ORIGIN,
      { kind: "conversation", conversationId: CONVERSATION_ID, ...BASE },
      "Kim Alvarez",
      "Dana Reyes",
    );
    const bulk = assignmentAlert(
      ORIGIN,
      { kind: "conversation_bulk", count: 3, ...BASE },
      "Sam Ortiz",
      null,
    );

    expect(again?.collapseKey).toBe(first?.collapseKey);
    // The batch keys per PERSON: a newer count supersedes the older one, and
    // it must not erase (or be erased by) a single-thread hand-off.
    expect(bulk?.collapseKey).toBe(`assigned:bulk:${ASSIGNEE}`);
    expect(bulk?.collapseKey).not.toBe(first?.collapseKey);
  });

  it("names a nameless contact by their number rather than saying nothing", () => {
    // A brand new lead has no name yet, and being handed one is exactly when
    // it matters most — "(no name)" would make the alert useless there.
    const alert = assignmentAlert(
      ORIGIN,
      { kind: "conversation", conversationId: CONVERSATION_ID, ...BASE },
      "Sam Ortiz",
      "+15550100",
    );

    expect(alert?.body).toBe("+15550100");
  });

  it("falls back to a plain noun when a task has no title", () => {
    const alert = assignmentAlert(
      ORIGIN,
      { kind: "task", taskId: TASK_ID, title: "   ", conversationId: null, ...BASE },
      "Sam Ortiz",
      null,
    );

    expect(alert?.body).toBe("A task");
  });
});

describe("assigning a conversation", () => {
  it("tells the new owner who handed it over, and links to the thread", async () => {
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation",
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(1);
  });

  it("says nothing when you assign a thread to yourself", async () => {
    // The overwhelmingly common case — the "claim it" button — and the one
    // that would make this feature intolerable if it woke anybody.
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation",
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        actorUserId: ACTOR,
        assigneeUserId: ACTOR,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(0);
  });

  it("says nothing to somebody who turned push off", async () => {
    const w = await world({
      prefs: [{ user_id: ASSIGNEE, push_enabled: false }],
    });
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation",
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(0);
  });

  it("says nothing to somebody who cannot see the number (#106)", async () => {
    // Assigning work on a hidden number is a mistake the ASSIGNER should
    // discover. Pushing the contact's name to the person who is not allowed to
    // see it would turn that mistake into the leak the gate exists to prevent.
    const w = await world({
      members: [{ user_id: ACTOR, role: "admin" }],
      conversation: [{ phone_number_id: "99999999-0000-4000-8000-000000000099" }],
    });
    // With a number on the conversation the audience comes from the resolver.
    w.sb.on("POST", "/rest/v1/rpc/number_member_levels", () => [
      { user_id: ACTOR, role: "admin", level: "full" },
      { user_id: ASSIGNEE, role: "member", level: "none" },
    ]);
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation",
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(0);
  });

  it("stays quiet, and does not throw, when the thread was deleted underneath it", async () => {
    // Best-effort by construction: the assignment itself succeeded, so a
    // vanished row must not be reported to the assigner as a failure.
    const w = await world({ conversation: [] });
    stubFetch(...w.routes);

    await expect(
      notifyAssigned(
        env,
        {
          kind: "conversation",
          companyId: COMPANY_ID,
          conversationId: CONVERSATION_ID,
          actorUserId: ACTOR,
          assigneeUserId: ASSIGNEE,
        },
        getDb(env),
      ),
    ).resolves.toBeUndefined();

    expect(w.sends).toHaveLength(0);
  });
});

describe("assigning a task", () => {
  it("wakes the assignee with the job's title", async () => {
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "task",
        companyId: COMPANY_ID,
        taskId: TASK_ID,
        title: "Re-pipe the Alvarez basement",
        conversationId: CONVERSATION_ID,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(1);
  });

  it("reaches a standalone task's assignee with no conversation to check", async () => {
    // A task with no thread has no number to be restricted by, so membership
    // is the whole question — and it still has to be asked.
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "task",
        companyId: COMPANY_ID,
        taskId: TASK_ID,
        title: "Order the fittings",
        conversationId: null,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(1);
  });

  it("says nothing to somebody who is no longer on the crew", async () => {
    const w = await world({ members: [{ user_id: ACTOR, role: "admin" }] });
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "task",
        companyId: COMPANY_ID,
        taskId: TASK_ID,
        title: "Order the fittings",
        conversationId: null,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(0);
  });
});

describe("assigning a whole selection", () => {
  it("sends ONE push for the batch, not one per conversation", async () => {
    // The bulk route accepts 1000 ids. Fanning that out per thread would be a
    // cost centre, a notification-shade wipeout, and a fast way to get rate
    // limited by Apple and Google.
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation_bulk",
        companyId: COMPANY_ID,
        count: 140,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(1);
  });

  it("says nothing when the bulk action applied to nothing", async () => {
    // A filter arm can match rows the RPC then refuses. "Sam assigned you 0
    // conversations" is worse than silence.
    const w = await world();
    stubFetch(...w.routes);

    await notifyAssigned(
      env,
      {
        kind: "conversation_bulk",
        companyId: COMPANY_ID,
        count: 0,
        actorUserId: ACTOR,
        assigneeUserId: ASSIGNEE,
      },
      getDb(env),
    );

    expect(w.sends).toHaveLength(0);
  });
});
