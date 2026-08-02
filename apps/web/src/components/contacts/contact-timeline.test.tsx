import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

const state: { entries: unknown[] } = { entries: [] };

// #517: the row can now name who answered a call, so the component reads the
// roster. Mocked with a real member so the naming path is exercised rather
// than silently skipped — an empty roster would make every assertion below
// pass against the fallback.
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: { data: [{ user_id: "u1", display_name: "Sam Ortiz" }] },
  }),
}));

vi.mock("@/lib/api/contact-timeline", () => ({
  useContactTimeline: () => ({
    data: { pages: [{ entries: state.entries, next_cursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

import { ContactTimeline } from "./contact-timeline";

/**
 * #324. The feature IS the interleaving, so these assert that the three record
 * types arrive in one list — and that each renders the thing a crew member is
 * actually looking for before a visit.
 */
function render(entries: unknown[]): string {
  state.entries = entries;
  return renderToStaticMarkup(<ContactTimeline contactId="c1" />);
}

const at = (iso: string, over: Record<string, unknown> = {}) => ({
  kind: "conversation",
  id: `id-${iso}`,
  occurred_at: iso,
  conversation_id: "conv-1",
  status: "open",
  detail: null,
  started_at: iso,
  talk_seconds: null,
  due_at: null,
  done: null,
  ...over,
});

describe("ContactTimeline (#324)", () => {
  it("renders all three kinds in ONE list", () => {
    // The whole point: a conversation, a call and a job in the same stream.
    // If these were ever split back into per-kind sections, the question this
    // exists to answer would need three reads again.
    const html = render([
      at("2026-07-20T10:00:00.000Z"),
      at("2026-07-19T09:00:00.000Z", {
        kind: "call",
        status: "answered",
        talk_seconds: 240,
      }),
      at("2026-07-18T08:00:00.000Z", {
        kind: "task",
        status: null,
        detail: "Replace the blower",
        done: false,
      }),
    ]);
    expect(html).toContain("Conversation");
    expect(html).toContain("Call answered");
    expect(html).toContain("Replace the blower");
  });

  it("says the talk time on an answered call, and not on a missed one", () => {
    // "0:00" on a missed call reads as a fault rather than as an absence.
    expect(
      render([at("2026-07-19T09:00:00.000Z", { kind: "call", status: "answered", talk_seconds: 245 })]),
    ).toContain("Talked for 4m 5s");
    const missed = render([
      at("2026-07-19T09:00:00.000Z", { kind: "call", status: "missed", talk_seconds: 0 }),
    ]);
    expect(missed).toContain("Missed call");
    expect(missed).toContain("No answer");
    expect(missed).not.toContain("Talked for");
  });

  it("marks a finished job done rather than showing a due date", () => {
    const done = render([
      at("2026-07-18T08:00:00.000Z", { kind: "task", detail: "Clean the vent", done: true, due_at: "2026-07-25T00:00:00.000Z" }),
    ]);
    expect(done).toContain("Done");
    expect(done).not.toContain("Due ");
  });

  it("does not link a call that never threaded", () => {
    // A dead link is worse than a plain row.
    const html = render([
      at("2026-07-19T09:00:00.000Z", { kind: "call", status: "missed", conversation_id: null }),
    ]);
    expect(html).not.toContain('href="/inbox/null"');
  });

  it("gives every day a jump anchor keyed by LOCAL date", () => {
    // <input type="date"> emits a local calendar day. Keying the anchor off the
    // UTC slice would put an evening call in Vancouver on the next day's
    // heading, so a jump to the day the crew remembers would land nowhere.
    const iso = "2026-07-20T10:00:00.000Z";
    const local = new Date(iso);
    const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    expect(render([at(iso)])).toContain(`data-timeline-day="${key}"`);
  });

  it("offers the date jump only when there is history to jump through", () => {
    expect(render([])).not.toContain('type="date"');
    expect(render([at("2026-07-20T10:00:00.000Z")])).toContain('type="date"');
  });

  it("says nothing has happened yet rather than showing an empty frame", () => {
    expect(render([])).toContain("Nothing yet.");
  });
});
