/**
 * #205 contact call history: the /calls row grammar scoped to one contact —
 * day-grouped newest-first, the inbound-missed tint, inline voicemail
 * playback, tap-through to the conversation, and honest empty/paging states.
 * The server owns the contact filter (contact_id) — nothing here re-filters.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Call } from "@/lib/api/types";

// Hoisted mock state the hooks read; tests seed it before rendering.
const state: {
  rows: Call[];
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
} = {
  rows: [],
  isPending: false,
  isError: false,
  hasNextPage: false,
};

vi.mock("@/lib/api/calls", () => ({
  useContactCalls: () => ({
    data: { pages: [{ data: state.rows, next_cursor: null }], pageParams: [] },
    isPending: state.isPending,
    isError: state.isError,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  // CallRow mounts VoicemailPlayer; keep its lazy URL query inert.
  useVoicemailUrl: () => ({ data: undefined, isFetching: false, isError: false }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ContactCallHistory, groupCallsByDay } from "./contact-call-history";

/** A local ISO timestamp `daysAgo` calendar days back (grouping is local-day). */
function atDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

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
    started_at: atDaysAgo(0),
    ...overrides,
  };
}

function render(): string {
  return renderToStaticMarkup(<ContactCallHistory contactId="ct-1" />);
}

beforeEach(() => {
  state.rows = [];
  state.isPending = false;
  state.isError = false;
  state.hasNextPage = false;
});

describe("ContactCallHistory (#205)", () => {
  it("renders the section header, the missed row grammar, and the conversation link", () => {
    state.rows = [call()];
    const html = render();
    expect(html).toContain("Call history");
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("Missed");
    // The inbound-missed tint — the row's one tinted element.
    expect(html).toContain("bg-warning/10");
    expect(html).toContain('href="/inbox/conv-1"');
  });

  it("groups rows under day headers, newest first", () => {
    state.rows = [
      call({ id: "today-1" }),
      call({
        id: "yesterday-1",
        started_at: atDaysAgo(1),
        outcome: "answered",
        forward_seconds: 30,
      }),
    ];
    const html = render();
    expect(html).toContain("Today");
    expect(html).toContain("Yesterday");
    expect(html.indexOf("Today")).toBeLessThan(html.indexOf("Yesterday"));
  });

  it("plays voicemail in place via the shared player affordance", () => {
    state.rows = [
      call({ id: "vm-1", outcome: "voicemail", voicemail_seconds: 42 }),
    ];
    const html = render();
    expect(html).toContain("Play voicemail (42s)");
  });

  it("never dead-links an unthreaded call", () => {
    state.rows = [
      call({
        id: "unthreaded",
        conversation_id: null,
        outcome: "answered",
        forward_seconds: 60,
      }),
    ];
    const html = render();
    expect(html).not.toContain('href="/inbox/');
    expect(html).toContain("Not linked to a conversation");
  });

  it("shows the quiet empty state when this contact has no calls", () => {
    const html = render();
    expect(html).toContain("No calls with this contact yet.");
    expect(html).toContain(
      "Calls between you and this customer will show up here.",
    );
  });

  it("offers Show more only when another page exists", () => {
    state.rows = [call()];
    state.hasNextPage = true;
    expect(render()).toContain("Show more");

    state.hasNextPage = false;
    expect(render()).not.toContain("Show more");
  });
});

describe("groupCallsByDay (#205)", () => {
  it("folds a DESC list into contiguous day groups without re-sorting", () => {
    const now = new Date(2026, 6, 22, 12, 0, 0); // local noon, July 22 2026
    const at = (y: number, m: number, d: number, h: number) =>
      new Date(y, m, d, h).toISOString();
    const rows = [
      call({ id: "a", started_at: at(2026, 6, 22, 9) }),
      call({ id: "b", started_at: at(2026, 6, 22, 8) }),
      call({ id: "c", started_at: at(2026, 6, 21, 17) }),
      call({ id: "d", started_at: at(2025, 11, 3, 10) }),
    ];
    const groups = groupCallsByDay(rows, now);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "December 3, 2025",
    ]);
    expect(groups[0].calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(groups[1].calls.map((c) => c.id)).toEqual(["c"]);
    expect(groups[2].calls.map((c) => c.id)).toEqual(["d"]);
  });
});
