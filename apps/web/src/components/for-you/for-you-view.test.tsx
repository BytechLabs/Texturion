/**
 * #133 For You "Recent calls": ambient call history renders BELOW the queue
 * (and below the caught-up card), never feeds the header count, links
 * threaded rows into the inbox and everything else at /calls, and stays
 * absent while there are no calls.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Call, ForYou, SpamReviewItem } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  forYou: ForYou;
  calls: Call[];
  spamReview: SpamReviewItem[];
  /** #540: the panels this member has put away. */
  hidden: string[];
} = {
  forYou: { waiting_on_you: [], my_tasks: [], unread: [], triage: null },
  calls: [],
  spamReview: [],
  hidden: [],
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
  // #354: this view now also mounts the pipeline panel. Loaded-with-no-data,
  // so the panel renders nothing and these assertions stay about the queue.
  usePipelineReport: () => ({ data: undefined, isLoading: false }),
  // #313: and the satisfaction panel. Pending, like the response time above —
  // it renders its loading skeleton and these assertions stay about the queue.
  useSatisfaction: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
  useLeadSourceReport: () => ({ isLoading: false, data: null }),
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
  // #540: the customise preference, driven from `state` so the tests below can
  // assert that a panel a member put away actually stays off the screen.
  useHiddenPanels: () => state.hidden,
  useSetHiddenPanels: () => ({ mutate: vi.fn(), isError: false }),
}));

vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ isPending: false, mutate: vi.fn() }),
  // #287: the outstanding queue's Chase button schedules a follow-up. What it
  // sends is pinned in outstanding-quotes-chase.test.tsx; here it only has to
  // exist, because the section renders on this screen.
  useSnoozeConversation: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));
// #287: the landing screen now carries the outstanding-quotes queue, which
// reads through react-query like every other list here. Empty for this suite —
// what it asserts is the follow-up section, and a second live query would only
// add a QueryClient this file has never needed.
vi.mock("@/lib/api/quotes", () => ({
  useOutstandingQuotes: () => ({ data: { data: [] } }),
}));

vi.mock("@/lib/api/calls", () => ({
  useCalls: () => ({
    data: { pages: [{ data: state.calls, next_cursor: null }] },
    isPending: false,
    isError: false,
  }),
}));
// #288: the referral ask reads a moment the server decides. Stubbed to "not
// now" for the whole suite — this file is about the queue, and a card that only
// appears for a workspace with a month of real traffic behind it has nothing to
// say about any of these cases. The one test that cares asserts it directly, in
// referral-ask.test.tsx.
vi.mock("@/lib/api/billing", () => ({
  useReferralMoment: () => ({ data: { ask: false, refusal: "too_new" } }),
  useReferrals: () => ({ data: undefined }),
  useDismissReferralAsk: () => ({ mutate: vi.fn() }),
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

const followUpItem = {
  conversation_id: "conv-f",
  status: "waiting",
  contact: { id: "ct-f", name: "Frank Quote", phone_e164: "+16135550222" },
  last_message_at: new Date().toISOString(),
  unread: false,
  due_at: new Date(Date.now() - 3_600_000).toISOString(),
  note: "chase the quote",
} as NonNullable<ForYou["follow_ups"]>[number];

function render(): string {
  return renderToStaticMarkup(<ForYouView />);
}

// #540: nothing put away unless a test says so. Without this, one test hiding a
// panel silently changes every test written after it, and the failure surfaces
// somewhere unrelated.
beforeEach(() => {
  state.hidden = [];
});

describe("ForYouView follow-up reminders (#293)", () => {
  it("leads with the reason, above everything else in the queue", () => {
    state.forYou = queue({
      follow_ups: [followUpItem],
      waiting_on_you: [waitingItem],
    });
    const html = render();
    expect(html).toContain("Chase these");
    expect(html).toContain("Frank Quote");
    // The REASON, not the last-message time: "chase the quote" is a job,
    // "Chase this" is a chore, and three days later only one of them is
    // actionable.
    expect(html).toContain("chase the quote");
    expect(html).toContain('href="/inbox/conv-f"');
    // A quote nobody answered is the most valuable thing to be reminded about,
    // and unlike every section below it this one only exists because the member
    // asked for it.
    // Compared on the ROW, not the section label: "Waiting on you" also
    // appears in the header's summary tiles, which sit above everything.
    expect(html.indexOf("Frank Quote")).toBeLessThan(
      html.indexOf("Wendy Lead"),
    );
  });

  it("falls back to naming the silence when no reason was given", () => {
    state.forYou = queue({ follow_ups: [{ ...followUpItem, note: null }] });
    const html = render();
    expect(html).toContain("No reply since");
  });

  it("keeps the caught-up card honest — a due reminder is not caught up", () => {
    state.forYou = queue({ follow_ups: [followUpItem] });
    const html = render();
    expect(html).not.toContain("You&#x27;re all caught up.");
    expect(html).toContain("Chase these");
  });

  it("renders nothing when an older Worker omits the section entirely", () => {
    // The field is optional on purpose: a client running ahead of the Worker
    // gets the pre-#293 behaviour, not a crash.
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    const html = render();
    expect(html).not.toContain("Chase these");
  });
});

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
    // The SECTION, by its anchor id. `indexOf("Waiting on you")` lands on the
    // summary tile, which sits above everything by construction — so the old
    // form proved only "Recent calls is below the header strip".
    expect(html.indexOf('id="for-you-waiting"')).toBeLessThan(
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

/**
 * #540 — the landing screen leads with the thing to do first.
 *
 * The complaint was a dashboard that "doesn't feel dynamic": four fixed tiles
 * over sections in a fixed order, identical whether the work in them was ten
 * minutes or ten days old. These assert the two halves of the fix — the strip is
 * ordered by urgency, and the sections below it follow the SAME order, because a
 * strip that disagrees with the page it indexes is worse than one that never
 * moves.
 */
describe("#540 the strip and the sections agree, and both lead with urgency", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  it("puts an overdue task ahead of unassigned work in BOTH the strip and the page", () => {
    state.forYou = {
      waiting_on_you: [],
      my_tasks: [
        {
          task_id: "t1",
          title: "Send the quote",
          conversation_id: "c1",
          message_id: "m1",
          assigned_user_id: "u1",
          due_at: hoursAgo(30),
          overdue: true,
        },
      ],
      unread: [],
      triage: {
        conversations: [
          {
            conversation_id: "c9",
            status: "new",
            contact: { id: "p9", name: "Ada", phone_e164: "+16135550100" },
            last_message_at: hoursAgo(1),
            unread: true,
          },
        ],
        tasks: [],
      },
    };
    const html = render();

    // The strip's first tile is the overdue one, and it says WHY rather than
    // leaving a bare number.
    const stripStart = html.indexOf('href="#for-you-');
    expect(html.slice(stripStart, stripStart + 40)).toContain("for-you-tasks");
    expect(html).toContain("1 overdue");

    // And the sections below follow: My tasks before Unassigned.
    // Anchor ids, not labels: the tile strip carries every queue's NAME above
    // the sections, so both sides used to resolve inside the strip and this
    // measured strip order against itself.
    expect(html.indexOf('id="for-you-tasks"')).toBeLessThan(html.indexOf('id="for-you-unassigned"'));
  });

  it("keeps the reading order when nothing is overdue or aged", () => {
    // Two fresh queues must not shuffle — a strip that rearranges on a few
    // minutes' difference is one nobody can learn, and learning where things are
    // is the point.
    state.forYou = {
      waiting_on_you: [],
      my_tasks: [],
      unread: [
        {
          conversation_id: "c2",
          status: "open",
          contact: { id: "p2", name: "Bo", phone_e164: "+16135550101" },
          assigned_user_id: "u1",
          last_message_at: hoursAgo(0.2),
        },
      ],
      triage: {
        conversations: [
          {
            conversation_id: "c3",
            status: "new",
            contact: { id: "p3", name: "Cy", phone_e164: "+16135550102" },
            last_message_at: hoursAgo(0.1),
            unread: true,
          },
        ],
        tasks: [],
      },
    };
    const html = render();
    expect(html.indexOf('id="for-you-unassigned"')).toBeLessThan(html.indexOf('id="for-you-unread"'));
  });

  it("promotes a queue that has gone stale over a busier fresh one", () => {
    // Count is not urgency. Three unread from ten minutes ago is an ordinary
    // morning; one thread unanswered since yesterday is a customer wondering
    // whether anybody read it.
    state.forYou = {
      waiting_on_you: [
        {
          conversation_id: "c4",
          status: "waiting",
          contact: { id: "p4", name: "Di", phone_e164: "+16135550103" },
          assigned_user_id: "u1",
          last_message_at: hoursAgo(26),
          has_overdue_task: false,
          urgency: 1,
          unread: false,
        },
      ],
      my_tasks: [],
      unread: [0.1, 0.2, 0.3].map((h, i) => ({
        conversation_id: `u${i}`,
        status: "open",
        contact: { id: `q${i}`, name: `E${i}`, phone_e164: "+16135550104" },
        assigned_user_id: "u1",
        last_message_at: hoursAgo(h),
      })),
      triage: null,
    };
    const html = render();
    expect(html.indexOf('id="for-you-waiting"')).toBeLessThan(html.indexOf('id="for-you-unread"'));
  });
});

/**
 * #540 — the layout, asserted where a class name can be read.
 *
 * These are deliberately narrow: a server-rendered string can prove which element
 * carries which responsive class, and cannot prove the result looks right at
 * 1440px. What they protect is the part that silently rots — the widest slot going
 * to the first queue that has work rather than to whichever one happens to be
 * declared first, which is exactly what breaks if somebody later reorders the
 * record instead of the array.
 */
describe("#540 the bento gives the widest slot to the queue that needs it", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  const overdueTask = {
    task_id: "t1",
    title: "Send the quote",
    conversation_id: "c1",
    message_id: "m1",
    assigned_user_id: "u1",
    due_at: hoursAgo(30),
    overdue: true,
  };

  const unreadItem = {
    conversation_id: "c-u",
    status: "open",
    contact: { id: "p-u", name: "Uma Unread", phone_e164: "+16135550107" },
    assigned_user_id: "u1",
    last_message_at: hoursAgo(0.2),
  } as ForYou["unread"][number];

  /**
   * The queue sections are anchored by their CONTENT, never by their heading.
   *
   * The summary tile strip renders every queue's NAME above the sections, so
   * `indexOf("My tasks")` lands on the tile — which made the original version
   * of the first test below slice an empty range and assert nothing at all. A
   * contact name and a task title appear only where the queue itself is drawn.
   */
  const TASK_ROW = "Send the quote";
  const WAITING_ROW = "Wendy Lead";
  const UNREAD_ROW = "Uma Unread";

  it("spans the first queue WITH WORK, not the first declared one", () => {
    // Unassigned is declared first. Here it is empty, My tasks is overdue and
    // Waiting on you also has work — so the double-width slot must go to My
    // tasks, with the other queue falling in beside it.
    state.forYou = {
      waiting_on_you: [waitingItem],
      my_tasks: [overdueTask],
      unread: [],
      triage: null,
    };
    const html = render();
    const spanAt = html.indexOf("xl:col-span-2");
    expect(spanAt).toBeGreaterThan(-1);
    // The wide wrapper opens before the My tasks ROWS, with no other queue's
    // rows in between.
    const between = html.slice(spanAt, html.indexOf(TASK_ROW));
    expect(between.length).toBeGreaterThan(0);
    expect(between).not.toContain(WAITING_ROW);
  });

  it("gives a LONE queue the whole row instead of leaving a column empty", () => {
    // The void this issue was reopened about, in its purest form. A single live
    // queue taking two of three columns leaves the third holding nothing — the
    // same dead space as a short panel beside a tall one, arrived at from the
    // other direction. It must take the full row instead.
    state.forYou = {
      waiting_on_you: [],
      my_tasks: [overdueTask],
      unread: [],
      triage: null,
    };
    const html = render();
    expect(html).toContain(TASK_ROW);
    // `xl:col-span-2` is the two-of-three slot and nothing else on this screen
    // uses it, so its ABSENCE is exactly the property: with nothing to put
    // beside the queue, no element claims two columns of three.
    expect(html).not.toContain("xl:col-span-2");
  });

  it("stacks the queues after the first rather than giving each a grid cell", () => {
    // WHY THIS IS THE FIX. A CSS grid quantises into rows: with three live
    // queues the primary spanned two columns, the second took the third, and
    // the third dropped to a new row leaving TWO empty tracks beside it. The
    // ones after the first share a single stacked column, so the space beside
    // the primary holds the next thing to do rather than air.
    state.forYou = {
      waiting_on_you: [waitingItem],
      my_tasks: [overdueTask],
      unread: [unreadItem],
      triage: null,
    };
    const html = render();
    const spanAt = html.indexOf("xl:col-span-2");
    expect(spanAt).toBeGreaterThan(-1);
    const stackAt = html.indexOf("space-y-7 lg:space-y-6", spanAt);
    expect(stackAt).toBeGreaterThan(spanAt);
    // The primary's rows come before the stack opens; both remaining queues'
    // rows come after it. So neither of them is a grid cell of its own, which
    // is what left the empty tracks.
    expect(html.indexOf(TASK_ROW)).toBeLessThan(stackAt);
    expect(html.indexOf(WAITING_ROW)).toBeGreaterThan(stackAt);
    expect(html.indexOf(UNREAD_ROW)).toBeGreaterThan(stackAt);
  });

  it("gives the measures their own row rather than four full-width bands", () => {
    state.forYou = {
      waiting_on_you: [],
      my_tasks: [],
      unread: [],
      triage: null,
    };
    // One row, and as many columns as actually have a card. A FIXED column count
    // is what this asserted first, and it was wrong in real pixels: two of these
    // cards decide for themselves whether to render, so a four-column row on a
    // workspace with three cards left an empty track — the dead space this issue
    // opened with, one card at a time. `auto-fit` collapses it.
    expect(render()).toContain("repeat(auto-fit,minmax(15rem,1fr))");
  });
});

describe("ForYouView customising (#540)", () => {
  it("keeps a panel off the screen when the member has put it away", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.calls = [call()];
    expect(render()).toContain("Recent calls");

    state.hidden = ["recent_calls"];
    expect(render()).not.toContain("Recent calls");
  });

  it("honours the same preference on a caught-up morning", () => {
    // TWO STATES, ONE PREFERENCE. The dashboard renders the measures in a
    // working queue AND under the caught-up card, and the second one is exactly
    // where a preference gets forgotten — it is the branch nobody looks at while
    // building the busy one.
    state.forYou = queue();
    state.calls = [call()];
    const busy = render();
    expect(busy).toContain("You&#x27;re all caught up.");
    expect(busy).toContain("Recent calls");

    state.hidden = ["recent_calls"];
    expect(render()).not.toContain("Recent calls");
  });

  it("offers no way to hide the queue", () => {
    // THE LINE. Hiding unclaimed work is not a preference — it is a way to stop
    // seeing customers nobody answered. Sending a queue id must change nothing,
    // and the shared module plus the API both refuse it; this is the third place,
    // asserting the SCREEN does not honour it either.
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.hidden = ["waiting", "unassigned", "tasks", "unread"];
    const html = render();
    expect(html).toContain("Waiting on you");
    expect(html).toContain("Wendy Lead");
  });

  it("marks the control when something is put away, and not before", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    // The dot is the only way somebody finds out why their dashboard is shorter
    // than a colleague's months after they trimmed it.
    expect(render()).toContain("Customise this screen");
    expect(render()).not.toContain("put away");

    state.hidden = ["pipeline", "recent_calls"];
    expect(render()).toContain("2 panels put away");
  });

  it("says panel, not panels, for one", () => {
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.hidden = ["pipeline"];
    expect(render()).toContain("1 panel put away");
  });

  it("draws no empty grid when every measure is off", () => {
    // An empty grid still carries its gap, so the screen keeps a band of space
    // that reads as four panels failing to load.
    state.forYou = queue({ waiting_on_you: [waitingItem] });
    state.hidden = [
      "response_time",
      "pipeline",
      "satisfaction",
      "lead_sources",
    ];
    expect(render()).not.toContain("repeat(auto-fit,minmax(15rem,1fr))");
  });
});
