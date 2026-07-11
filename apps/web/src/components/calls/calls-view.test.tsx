/**
 * #129 /calls surface: rows with honest outcomes, threaded rows link into
 * the inbox, unthreaded rows never dead-link, and the empty states speak the
 * feature's language.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Call } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  rows: Call[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  voiceEnabled: boolean;
} = {
  rows: [],
  isPending: false,
  isError: false,
  hasNextPage: false,
  voiceEnabled: true,
};

vi.mock("@/lib/api/calls", () => ({
  useCalls: () => ({
    data: { pages: [{ data: state.rows, next_cursor: null }] },
    isPending: state.isPending,
    isError: state.isError,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: { enabled_modules: state.voiceEnabled ? ["voice"] : [] },
  }),
}));

import { CallsView } from "./calls-view";

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
    direction: "inbound",
    caller_e164: "+16135551000",
    contact_id: "ct-1",
    contact_name: "Dana Roofer",
    phone_number_id: "pn-1",
    conversation_id: "conv-1",
    outcome: "missed",
    forward_seconds: 0,
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function render(): string {
  return renderToStaticMarkup(<CallsView />);
}

describe("CallsView (#129)", () => {
  it("renders contact name, the missed pill, and the conversation link", () => {
    state.rows = [call()];
    state.isPending = false;
    state.isError = false;
    const html = render();
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("Missed");
    expect(html).toContain('href="/inbox/conv-1"');
  });

  it("shows answered talk time and formats an unknown caller's number", () => {
    state.rows = [
      call({
        id: "call-2",
        contact_name: null,
        contact_id: null,
        outcome: "answered",
        forward_seconds: 272,
      }),
    ];
    const html = render();
    expect(html).toContain("Answered · 4m 32s");
    expect(html).toContain("(613) 555-1000");
  });

  it("never dead-links an unthreaded call (anonymous caller)", () => {
    state.rows = [
      call({
        id: "call-3",
        caller_e164: null,
        contact_name: null,
        contact_id: null,
        conversation_id: null,
        outcome: "answered",
        forward_seconds: 60,
      }),
    ];
    const html = render();
    expect(html).toContain("Unknown caller");
    expect(html).not.toContain('href="/inbox/');
  });

  it("D38: outbound rows speak from the crew's side and a no-answer is never a warning pill", () => {
    state.rows = [
      call({
        id: "call-out-1",
        direction: "outbound",
        outcome: "answered",
        forward_seconds: 192,
      }),
      call({
        id: "call-out-2",
        direction: "outbound",
        outcome: "missed",
        forward_seconds: 0,
      }),
    ];
    const html = render();
    expect(html).toContain("You called · 3m 12s");
    expect(html).toContain("No answer");
    expect(html).not.toContain("Missed</span>");
    // The warning tint is reserved for inbound misses (accent budget).
    expect(html).not.toContain("bg-warning/10");
  });

  it("empty state points at the calls settings and names the Calling add-on", () => {
    state.rows = [];
    const html = render();
    expect(html).toContain("Calls to your business number will show up here.");
    expect(html).toContain(
      "Turn on the Calling add-on or missed-call text-back",
    );
    expect(html).toContain('href="/settings/missed-calls"');
  });

  it("#133: each row carries a muted direction glyph next to the outcome", () => {
    state.rows = [
      call({ id: "in-missed", outcome: "missed" }),
      call({ id: "in-answered", outcome: "answered", forward_seconds: 30 }),
      call({
        id: "out-answered",
        direction: "outbound",
        outcome: "answered",
        forward_seconds: 30,
      }),
    ];
    const html = render();
    expect(html).toContain("lucide-phone-missed");
    expect(html).toContain("lucide-phone-incoming");
    expect(html).toContain("lucide-phone-outgoing");
  });

  it("#133: an unthreaded row explains itself; threaded rows don't", () => {
    state.rows = [
      call({
        id: "unthreaded",
        conversation_id: null,
        caller_e164: null,
        contact_name: null,
        contact_id: null,
        outcome: "answered",
        forward_seconds: 60,
      }),
    ];
    let html = render();
    expect(html).toContain("Not linked to a conversation");

    state.rows = [call()];
    html = render();
    expect(html).not.toContain("Not linked to a conversation");
  });
});

/**
 * #133: the log keeps working with the voice module off (history is history),
 * but a slim banner above the list says calling itself is off and points at
 * the Calling add-on. Never shown while the module is on, and never doubled
 * onto the empty state (which already carries the setup pointer).
 */
describe("CallsView module-off banner (#133)", () => {
  it("shows the banner above rows when the voice module is off", () => {
    state.voiceEnabled = false;
    state.rows = [call()];
    const html = render();
    expect(html).toContain("Calls land here, but calling is off");
    expect(html).toContain("Calling add-on");
    expect(html).toContain("to ring your cell and call customers back");
    expect(html).toContain('href="/settings/billing"');
  });

  it("hides the banner when there are no rows (the empty state speaks instead)", () => {
    state.voiceEnabled = false;
    state.rows = [];
    const html = render();
    expect(html).not.toContain("Calls land here, but calling is off");
    expect(html).toContain("Calls to your business number will show up here.");
  });

  it("hides the banner when the module is on", () => {
    state.voiceEnabled = true;
    state.rows = [call()];
    const html = render();
    expect(html).not.toContain("Calls land here, but calling is off");
    expect(html).not.toContain('href="/settings/billing"');
  });
});
