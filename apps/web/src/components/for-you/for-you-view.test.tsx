/**
 * #133 For You "Recent calls": ambient call history renders BELOW the queue
 * (and below the caught-up card), never feeds the header count, links
 * threaded rows into the inbox and everything else at /calls, and stays
 * absent while there are no calls.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Call, ForYou, SpamReviewItem } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  forYou: ForYou;
  calls: Call[];
  spamReview: SpamReviewItem[];
} = {
  forYou: { waiting_on_you: [], my_tasks: [], unread: [], triage: null },
  calls: [],
  spamReview: [],
};

// #416: deliberately a plain MEMBER, not an owner. Before #416 this flip
// alone would have hidden the unassigned queue from every test below it — the
// view read the role and gated on it. Nothing here reads the role now, which
// is the fix, and pinning the mock to the LEAST privileged role is what keeps
// a future role gate from being reintroduced unnoticed.
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", role: "member" }),
  // #239: the response-time panel resolves the company for its own query.
  useCompanyId: () => "co-1",
}));
// #239: the panel is part of this surface now, but it is not what these tests
// are about — they assert the queue's anatomy. Stubbed to its "nothing to
// measure yet" state so it renders deterministically and adds no rows that could
// be mistaken for queue items. Its own copy is covered by
// response-time-card.test.ts.
vi.mock("@/lib/api/reports", () => ({
  useResponseTime: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/for-you", () => ({
  useForYou: () => ({
    data: state.forYou,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCompleteForYouTask: () => ({ isPending: false, mutate: vi.fn() }),
  // #342: the spam-review strip. Empty by default so every existing case
  // still describes the queue alone; `state.spamReview` fills it.
  useSpamReview: () => ({ data: { data: state.spamReview } }),
}));
// The strip's two buttons act through the shared conversation mutation. Mocked
// rather than let through, because the real module validates public env at
// import time and this suite has none.
// #310: the waiting-room card reads the company view. Mocked here for the same
// reason the others are — importing the real hook pulls the API client's
// module-level env validation into a test about queue rendering.
vi.mock("@/lib/api/me-company", () => ({
  useMeCompany: () => ({ data: undefined }),
}));

vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/calls", () => ({
  useCalls: () => ({
    data: { pages: [{ data: state.calls, next_cursor: null }] },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/tasks/use-task-drawer", () => ({
  useTaskDrawer: () => ({ openTask: vi.fn() }),
}));

import { countDistinctWork, ForYouView } from "./for-you-view";

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
    call_session_id: "sess-call-1",
    direction: "inbound",
    caller_e164: "+16135551000",
    contact_id: "ct-1",
    contact_name: "Dana Roofer",
    caller_name: null,
    phone_number_id: "pn-1",
    conversation_id: "conv-1",
    outcome: "missed",
    forward_seconds: 0,
    screening_result: null,
    stir_attestation: null,
    voicemail_seconds: null,
  voicemail_transcript: null,
  voicemail_intake: null,
    answered_by_user_id: null,
    answered_by_name: null,
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function queue(overrides: Partial<ForYou> = {}): ForYou {
  return {
    waiting_on_you: [],
    my_tasks: [],
    unread: [],
    triage: null,
    ...overrides,
  };
}

const waitingItem = {
  conversation_id: "conv-w",
  status: "open",
  contact: { id: "ct-w", name: "Wendy Lead", phone_e164: "+16135550111" },
  assigned_user_id: null,
  last_message_at: new Date().toISOString(),
  unread: true,
  has_overdue_task: false,
  urgency: 1,
} as ForYou["waiting_on_you"][number];

function render(): string {
  return renderToStaticMarkup(<ForYouView />);
}

describe("ForYouView Recent calls (#133)", () => {
  it("renders the section below the queue with row anatomy and the /calls jump", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [call()];
    const html = render();
    expect(html).toContain("Recent calls");
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("Missed");
    expect(html).toContain('href="/inbox/conv-1"');
    expect(html).toContain("View all calls");
    expect(html).toContain('href="/calls"');
    // Ambient history sits AFTER the actionable sections.
    expect(html.indexOf("Waiting on you")).toBeLessThan(
      html.indexOf("Recent calls"),
    );
  });

  it("shows at most three calls from the first page", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [
      call({ id: "c1", contact_name: "Caller One" }),
      call({ id: "c2", contact_name: "Caller Two" }),
      call({ id: "c3", contact_name: "Caller Three" }),
      call({ id: "c4", contact_name: "Caller Four" }),
    ];
    const html = render();
    expect(html).toContain("Caller One");
    expect(html).toContain("Caller Three");
    expect(html).not.toContain("Caller Four");
  });

  it("renders nothing call-shaped when the log is empty", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [];
    const html = render();
    expect(html).not.toContain("Recent calls");
    expect(html).not.toContain("View all calls");
  });

  it("keeps the caught-up card AND renders calls below it when the queue is clear", () => {
    state.forYou = queue();
    state.calls = [call()];
    const html = render();
    expect(html).toContain("You&#x27;re all caught up.");
    expect(html).toContain("Recent calls");
    expect(html.indexOf("caught up")).toBeLessThan(
      html.indexOf("Recent calls"),
    );
  });

  it("never counts calls in the header — history is not workload", () => {
    // Queue empty + calls present: the header still says caught up.
    state.forYou = queue();
    state.calls = [call()];
    let html = render();
    expect(html).not.toContain("need");

    // One queue item + three calls: the count stays 1.
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [call({ id: "c1" }), call({ id: "c2" }), call({ id: "c3" })];
    html = render();
    expect(html).toContain("1 thing needs you");
  });

  it("routes unthreaded rows to /calls and speaks from the crew's side outbound", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [
      call({
        id: "anon",
        caller_e164: null,
        contact_name: null,
        contact_id: null,
        conversation_id: null,
        outcome: "answered",
        forward_seconds: 45,
      }),
      call({
        id: "out",
        direction: "outbound",
        conversation_id: "conv-out",
        outcome: "answered",
        forward_seconds: 192,
      }),
    ];
    const html = render();
    expect(html).toContain("Unknown caller");
    expect(html).toContain('href="/calls"');
    expect(html).toContain("You called · 3m 12s");
    expect(html).toContain('href="/inbox/conv-out"');
  });

  it("keeps the warning tint for inbound misses only (accent budget #64)", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [call({ id: "m", outcome: "missed" })];
    let html = render();
    expect(html).toContain("bg-warning/10");

    state.calls = [
      call({ id: "a", outcome: "answered", forward_seconds: 30 }),
      call({ id: "no", direction: "outbound", outcome: "missed" }),
    ];
    html = render();
    expect(html).not.toContain("bg-warning/10");
  });
});

describe("countDistinctWork", () => {
  const conv = (id: string) => ({ conversation_id: id }) as never;
  const task = (id: string) => ({ task_id: id }) as never;

  it("counts a thread once however many sections carry it", () => {
    // "unread" is a cross-cut of "waiting on you", not a separate pile, so a
    // thread in both is one thing to do. Adding the sections up reported more
    // work than there was.
    expect(
      countDistinctWork({
        waiting_on_you: [conv("a"), conv("b")],
        my_tasks: [],
        unread: [conv("a")],
        triage: null,
      } as never),
    ).toBe(2);
  });

  it("counts tasks and conversations together", () => {
    expect(
      countDistinctWork({
        waiting_on_you: [conv("a")],
        my_tasks: [task("t1")],
        unread: [],
        triage: { conversations: [conv("c")], tasks: [task("t2")] },
      } as never),
    ).toBe(4);
  });

  it("counts a task once when triage and my tasks both carry it", () => {
    expect(
      countDistinctWork({
        waiting_on_you: [],
        my_tasks: [task("t1")],
        unread: [],
        triage: { conversations: [], tasks: [task("t1")] },
      } as never),
    ).toBe(1);
  });

  it("reads an empty queue as nothing to do", () => {
    expect(
      countDistinctWork({
        waiting_on_you: [],
        my_tasks: [],
        unread: [],
        triage: null,
      } as never),
    ).toBe(0);
  });
});

describe("the unassigned queue reaches the crew, not just the office (#416)", () => {
  it("renders the section for a plain member", () => {
    // The company texts every active member when a lead lands unclaimed. If
    // the queue is owner-only, that notification points at a screen its own
    // audience cannot open — which is the whole of #416.
    state.calls = [];
    state.forYou = queue({
      triage: {
        conversations: [
          {
            conversation_id: "conv-t",
            status: "new",
            contact: { id: "ct-t", name: "Unclaimed Caller", phone_e164: "+16135550199" },
            last_message_at: new Date().toISOString(),
            unread: true,
          },
        ],
        tasks: [],
      },
    });

    const html = render();
    expect(html).toContain("Unassigned");
    expect(html).toContain("Unclaimed Caller");
  });

  it("says unassigned rather than triage, the word the rest of the app uses", () => {
    // "Triage" was written for a dispatcher screen. The crew reading it now
    // are the field staff, and every other surface calls this unassigned.
    state.calls = [];
    state.forYou = queue({
      triage: { conversations: [], tasks: [] },
      totals: {
        waiting_on_you: 0,
        my_tasks: 0,
        unread: 0,
        triage_conversations: 3,
        triage_tasks: 0,
        distinct_work: 3,
      },
    });

    const html = render();
    expect(html).not.toContain("Triage");
  });
});

describe("marked spam, still texting (#342)", () => {
  function flagged(overrides: Partial<SpamReviewItem> = {}): SpamReviewItem {
    return {
      conversation_id: "conv-spam-1",
      contact: { id: "c1", name: "Real Customer", phone_e164: "+16135551000" },
      marked_at: "2026-06-26T12:00:00Z",
      marked_by_user_id: "u1",
      inbound_since: 4,
      last_inbound_at: "2026-07-25T09:00:00Z",
      we_texted_them: true,
      sustained: false,
      high_volume: false,
      ...overrides,
    };
  }

  it("renders nothing when nothing is flagged", () => {
    // Every ordinary day. A strip that lists robotexters is the noise the
    // silent-append rule exists to remove, put back.
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.spamReview = [];
    expect(render()).not.toContain("Marked spam, still texting");
  });

  it("shows up even when the queue says you are all caught up", () => {
    // The failure this exists for: "you're all caught up" is a lie if somebody
    // has been texting a thread nobody can see.
    state.forYou = queue({});
    state.spamReview = [flagged()];
    const html = render();

    expect(html).toContain("Marked spam, still texting");
    expect(html).toContain("Real Customer");
    expect(html).toContain('href="/inbox/conv-spam-1"');
    expect(html).toContain("You&#x27;re all caught up.");
  });

  it("says which signal raised it rather than just a count", () => {
    state.forYou = queue({});
    state.spamReview = [flagged()];
    // "4 messages since" is a counter. "You texted them" is the mistake.
    expect(render()).toContain("You texted them before this was marked");
  });

  it("falls back to the count when there is no stronger signal", () => {
    state.forYou = queue({});
    state.spamReview = [
      flagged({ we_texted_them: false, sustained: false, inbound_since: 12 }),
    ];
    expect(render()).toContain("12 messages since it was marked");
  });

  it("offers both answers, so the prompt can be ended either way", () => {
    state.forYou = queue({});
    state.spamReview = [flagged()];
    const html = render();
    expect(html).toContain("Not spam");
    expect(html).toContain("Still spam");
  });
});

describe("the headline is the work, not the page (#306)", () => {
  const totals = {
    waiting_on_you: 63,
    my_tasks: 4,
    unread: 41,
    triage_conversations: 0,
    triage_tasks: 0,
    distinct_work: 67,
  };

  it("reports the server's number, not the number of rows on screen", () => {
    // The defect: twenty rows came back, so the busiest crew was told
    // "20 things need you" and the queue looked finished.
    state.forYou = queue({
      waiting_on_you: Array.from({ length: 20 }, (_, i) => ({
        ...waitingItem,
        conversation_id: `c${i}`,
      })),
      totals,
    });
    state.spamReview = [];
    const html = render();

    expect(html).toContain("67 things need you");
    expect(html).not.toContain("20 things need you");
  });

  it("says a section is a page of something bigger, and where the rest is", () => {
    state.forYou = queue({
      waiting_on_you: Array.from({ length: 20 }, (_, i) => ({
        ...waitingItem,
        conversation_id: `c${i}`,
      })),
      totals,
    });
    const html = render();

    expect(html).toContain("Showing 20 of");
    expect(html).toContain("63");
    expect(html).toContain('href="/inbox?assignee=me"');
  });

  it("sends the my-tasks overflow to the open list, not one that includes done", () => {
    // `/tasks?tab=mine` drops the status filter, so it lists completed tasks
    // too — the wrong place to send someone looking for the work they are
    // behind on. Bare /tasks is List · Open · Mine.
    state.forYou = queue({
      my_tasks: Array.from({ length: 20 }, (_, i) => ({
        task_id: `t${i}`,
        title: "Call back about the quote",
        conversation_id: "conv-w",
        message_id: `m${i}`,
        assigned_user_id: null,
        due_at: null,
        overdue: false,
      })) as ForYou["my_tasks"],
      totals: { ...totals, waiting_on_you: 0, my_tasks: 44 },
    });
    const html = render();

    expect(html).toContain('href="/tasks"');
    expect(html).not.toContain("tab=mine");
  });

  it("shows no overflow when the section fits", () => {
    state.forYou = queue({
      waiting_on_you: [waitingItem],
      totals: { ...totals, waiting_on_you: 1, unread: 0, my_tasks: 0, distinct_work: 1 },
    });
    expect(render()).not.toContain("Showing 1 of");
  });

  it("falls back to counting rows when the server sends no totals", () => {
    // A client running ahead of the Worker keeps today's behaviour — an
    // undercount — rather than rendering a new wrong number or nothing.
    state.forYou = queue({
      waiting_on_you: [waitingItem],
    });
    const html = render();

    expect(html).toContain("1 thing needs you");
    expect(html).not.toContain("Showing 1 of");
  });
});
