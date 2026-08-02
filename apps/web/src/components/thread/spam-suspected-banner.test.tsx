/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Conversation } from "@/lib/api/types";

import { SpamSuspectedBanner } from "./spam-suspected-banner";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

const mutate = vi.fn();
vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ mutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * #250 — the classifier's one visible effect.
 *
 * The suspicion suppresses a push and nothing else, so the banner IS the
 * feature's honesty: without it a thread would go quiet for reasons nobody
 * could see. These pin that it appears only when there is something to say,
 * that it explains itself, and that it never implies the thread was hidden.
 */
function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    company_id: "co-1",
    contact_id: "ct-1",
    phone_number_id: "num-1",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    last_message_at: "2026-08-02T10:00:00Z",
    closed_at: null,
    emergency_at: null,
    created_at: "2026-08-02T09:00:00Z",
    updated_at: "2026-08-02T10:00:00Z",
    ...over,
  } as Conversation;
}

const SUSPECTED = conversation({
  spam_suspected_at: "2026-08-02T10:00:00Z",
  spam_signals: [
    {
      key: "sender_not_dialable",
      weight: 2,
      why: "The sender is a shortcode or a name, not a phone somebody could call back.",
    },
    {
      key: "bulk_footer",
      weight: 2,
      why: "It carries the unsubscribe footer a bulk sender is required to add.",
    },
  ],
});

describe("SpamSuspectedBanner", () => {
  it("renders nothing on an ordinary thread", () => {
    // Which is almost every thread. A banner that shows up empty would put a
    // spam question on every real customer's conversation.
    const { container } = render(
      <SpamSuspectedBanner conversation={conversation()} canAct />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("says why, in the server's own sentences", () => {
    render(<SpamSuspectedBanner conversation={SUSPECTED} canAct />);
    expect(screen.getByText("This looks like spam")).toBeTruthy();
    // A verdict somebody cannot check is one they learn to dismiss.
    expect(
      screen.getByText(/shortcode or a name, not a phone somebody could call back/),
    ).toBeTruthy();
    expect(
      screen.getByText(/unsubscribe footer a bulk sender is required to add/),
    ).toBeTruthy();
  });

  it("promises that nothing was hidden", () => {
    // The load-bearing sentence. If a crew believes a suspected thread might
    // be hidden somewhere, the feature has cost them trust it never earned.
    render(<SpamSuspectedBanner conversation={SUSPECTED} canAct />);
    expect(screen.getByText(/Nothing is hidden/)).toBeTruthy();
  });

  it("clears the suspicion in one tap, and only ever to false", () => {
    mutate.mockClear();
    render(<SpamSuspectedBanner conversation={SUSPECTED} canAct />);
    fireEvent.click(screen.getByRole("button", { name: "Not spam" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ spam_suspected: false });
  });

  it("shows an observer the reasons but not the button", () => {
    // read_only cannot PATCH the thread, so offering the button would be a
    // control that always fails. The explanation is still theirs to read.
    render(<SpamSuspectedBanner conversation={SUSPECTED} canAct={false} />);
    expect(screen.getByText("This looks like spam")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not spam" })).toBeNull();
  });

  it("still renders when the reasons are missing", () => {
    // An older row, or a signals column that failed to decode. The heading is
    // the part that must never disappear.
    render(
      <SpamSuspectedBanner
        conversation={conversation({ spam_suspected_at: "2026-08-02T10:00:00Z" })}
        canAct
      />,
    );
    expect(screen.getByText("This looks like spam")).toBeTruthy();
  });
});
