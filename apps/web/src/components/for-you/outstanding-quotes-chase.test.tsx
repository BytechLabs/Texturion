/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { followUpPresets } from "@loonext/shared";

import type { Quote } from "@/lib/api/quotes";
import type { SnoozeConversationInput } from "@/lib/api/conversations";

/**
 * #287 — "outstanding quotes are a queue WITH FOLLOW-UP".
 *
 * The queue half answers "which ones", and the issue's other complaint was that
 * "nothing reminds anyone about money not yet won". These pin the reminder: not
 * that a button exists, but that pressing it schedules the right thing with a
 * note somebody can act on three days later.
 *
 * That distinction is the lesson this feature already taught once. Three
 * defects shipped in the quote send because every test asserted AUTHORITY —
 * that the control was offered to the right person — and none asserted EFFECT.
 * A "Chase" button that renders and posts nothing would pass a render test and
 * fail every crew member who pressed it.
 */

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

let rows: Quote[] = [];
let role = "owner";
const sent: SnoozeConversationInput[] = [];
let failNext = false;

vi.mock("@/lib/api/quotes", () => ({
  useOutstandingQuotes: () => ({ data: { data: rows } }),
}));

vi.mock("@/lib/api/calls", () => ({ useCalls: () => ({ data: undefined }) }));

vi.mock("@/lib/api/conversations", () => ({
  useSnoozeConversation: () => ({
    mutate: (
      input: SnoozeConversationInput,
      opts?: { onError?: () => void },
    ) => {
      sent.push(input);
      if (failNext) opts?.onError?.();
    },
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role }),
  useCompanyId: () => "company-1",
}));

import { OutstandingQuotesSection } from "./outstanding-quotes-section";

const quote = (over: Partial<Quote> = {}): Quote =>
  ({
    id: "q1",
    conversation_id: "conv-42",
    contact_id: "k1",
    amount_cents: 45_000,
    currency: "usd",
    description: "Replace the water heater",
    status: "sent",
    effective_status: "sent",
    expires_at: "2099-09-01T00:00:00Z",
    sent_at: "2026-08-07T09:00:00Z",
    viewed_at: null,
    decided_at: null,
    created_at: "2026-08-07T09:00:00Z",
    ...over,
  }) as Quote;

const chase = () => fireEvent.click(screen.getByRole("button", { name: "Chase" }));

describe("#287 chasing an unanswered quote", () => {
  it("schedules a follow-up on the thread the quote went out in", () => {
    rows = [quote()];
    sent.length = 0;
    failNext = false;
    role = "owner";
    render(<OutstandingQuotesSection />);
    chase();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.conversationId).toBe("conv-42");
    // 'follow_up', not 'snooze'. Both hide the thread while pending; only this
    // one brings it back as something to chase, which is the entire ask.
    expect(sent[0]!.kind).toBe("follow_up");
  });

  it("uses the follow-up ladder rather than a fourth clock", () => {
    // #293's own comment says "this afternoon" is a meaningless time to chase a
    // quote. The soonest rung on the ladder built for this is the default, and
    // computing a date here instead is how the two drift apart.
    rows = [quote()];
    sent.length = 0;
    render(<OutstandingQuotesSection />);
    chase();

    const expected = followUpPresets()[0]!;
    expect(Date.parse(sent[0]!.until)).toBe(expected.at);
  });

  it("writes a note that still means something in three days", () => {
    // "Chase this" is a chore. The figure and the work make it a job — and the
    // reminder surfaces this note verbatim in the Chase these queue.
    rows = [quote()];
    sent.length = 0;
    render(<OutstandingQuotesSection />);
    chase();

    expect(sent[0]!.note).toContain("450");
    expect(sent[0]!.note).toContain("Replace the water heater");
  });

  it("keeps the note inside the length the API accepts", () => {
    // The endpoint caps a note at 120 characters and 422s past it. A long
    // description is ordinary — "replace the water heater and re-run the
    // supply line…" — so an untruncated note is a chase that silently fails.
    rows = [quote({ description: "x".repeat(400) })];
    sent.length = 0;
    render(<OutstandingQuotesSection />);
    chase();

    expect(sent[0]!.note!.length).toBeLessThanOrEqual(120);
  });

  it("says it is chasing once it has been pressed", () => {
    rows = [quote()];
    sent.length = 0;
    failNext = false;
    render(<OutstandingQuotesSection />);
    chase();

    expect(screen.queryByRole("button", { name: "Chase" })).toBeNull();
    expect(screen.getByText("Chasing")).toBeTruthy();
  });

  it("puts the button back when the schedule did not take", () => {
    // A row claiming "Chasing" with nothing scheduled is worse than one that
    // never claimed to: the crew member stops thinking about it.
    rows = [quote()];
    sent.length = 0;
    failNext = true;
    render(<OutstandingQuotesSection />);
    chase();

    expect(screen.getByRole("button", { name: "Chase" })).toBeTruthy();
  });

  it("does not offer it to somebody who cannot write on a thread", () => {
    // Chasing writes a note, which read_only cannot do. The queue itself stays
    // — the list is the report, and an observer who can see every thread
    // should be able to see the money in them.
    rows = [quote()];
    role = "read_only";
    render(<OutstandingQuotesSection />);

    expect(screen.queryByRole("button", { name: "Chase" })).toBeNull();
    expect(screen.getByText("Replace the water heater")).toBeTruthy();
    role = "owner";
  });
});
