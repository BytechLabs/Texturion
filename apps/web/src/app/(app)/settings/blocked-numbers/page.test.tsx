/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const unblockMutate = vi.fn();
const state = {
  rows: [] as {
    id: string;
    phone_e164: string;
    reason: string | null;
    blocked_by: string | null;
    created_at: string;
  }[],
};

vi.mock("@/lib/api/blocked-senders", () => ({
  useBlockedSenders: () => ({
    isPending: false,
    isError: false,
    data: { data: state.rows },
    refetch: vi.fn(),
  }),
  useUnblockSender: () => ({ mutate: unblockMutate, isPending: false }),
}));
vi.mock("@/components/inbox/member-avatar", () => ({
  useMemberNames: () => new Map([["u-1", "Priya Natarajan"]]),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import BlockedNumbersPage from "./page";

beforeEach(() => {
  unblockMutate.mockReset();
  state.rows = [];
});

describe("/settings/blocked-numbers", () => {
  it("says so when nothing is blocked", () => {
    render(<BlockedNumbersPage />);
    expect(screen.getByText("No blocked numbers.")).toBeTruthy();
  });

  it("lists the number formatted, who blocked it, and the reason", () => {
    state.rows = [
      {
        id: "b-1",
        phone_e164: "+14165550182",
        reason: "Keeps calling at night",
        blocked_by: "u-1",
        created_at: "2026-01-02T10:00:00Z",
      },
    ];
    render(<BlockedNumbersPage />);
    expect(screen.getByText("(416) 555-0182")).toBeTruthy();
    expect(screen.getByText(/Blocked by Priya Natarajan/)).toBeTruthy();
    expect(screen.getByText("Reason: Keeps calling at night")).toBeTruthy();
  });

  it("unblocks the row's id", () => {
    state.rows = [
      {
        id: "b-7",
        phone_e164: "+14165550182",
        reason: null,
        blocked_by: null,
        created_at: "2026-01-02T10:00:00Z",
      },
    ];
    render(<BlockedNumbersPage />);
    fireEvent.click(screen.getByRole("button", { name: "Unblock (416) 555-0182" }));
    expect(unblockMutate.mock.calls[0][0]).toBe("b-7");
  });
});
