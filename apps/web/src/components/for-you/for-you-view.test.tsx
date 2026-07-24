/**
 * #133 For You "Recent calls": ambient call history renders BELOW the queue
 * (and below the caught-up card), never feeds the header count, links
 * threaded rows into the inbox and everything else at /calls, and stays
 * absent while there are no calls.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Call, ForYou } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  forYou: ForYou;
  calls: Call[];
} = {
  forYou: { waiting_on_you: [], my_tasks: [], unread: [], triage: null },
  calls: [],
};

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", role: "owner" }),
}));
vi.mock("@/lib/api/for-you", () => ({
  useForYou: () => ({
    data: state.forYou,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCompleteForYouTask: () => ({ isPending: false, mutate: vi.fn() }),
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

import { ForYouView } from "./for-you-view";

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
