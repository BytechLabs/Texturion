/**
 * #129 /calls surface: rows with honest outcomes, threaded rows link into
 * the inbox, unthreaded rows never dead-link, and the empty states speak the
 * feature's language.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Call } from "@/lib/api/types";

// Hoisted mock state the useCalls hook reads; tests seed it before rendering.
const state: {
  rows: Call[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
} = { rows: [], isPending: false, isError: false, hasNextPage: false };

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

import { CallsView } from "./calls-view";

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
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

  it("empty state points at the calls settings", () => {
    state.rows = [];
    const html = render();
    expect(html).toContain("Calls to your business number will show up here.");
    expect(html).toContain('href="/settings/missed-calls"');
  });
});
