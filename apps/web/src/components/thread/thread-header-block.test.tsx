/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationDetail } from "@/lib/api/types";

import { ALL_CATEGORIES_ON } from "./thread-filter";

afterEach(cleanup);

const blockMutate = vi.fn();
const unblockMutate = vi.fn();
const rows = { current: [] as { id: string; phone_e164: string }[] };
const role = { current: "member" as string };

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkConversationUnread: () => ({ mutate: vi.fn(), isPending: false }),
  useSnoozeConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useUnsnoozeConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMuteConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useUnmuteConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useFollowConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useOptOutContact: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeOptOut: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/blocked-senders", () => ({
  useBlockedSenders: () => ({ data: { data: rows.current } }),
  useBlockSender: () => ({ mutate: blockMutate, isPending: false }),
  useUnblockSender: () => ({ mutate: unblockMutate, isPending: false }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    companyId: "co-1",
    userId: "u-1",
    role: role.current,
  }),
}));

import { ThreadHeader } from "./thread-header";

const PHONE = "+12125550123";

const CONVERSATION = {
  id: "conv-1",
  company_id: "co-1",
  contact_id: "ct-1",
  phone_number_id: "num-1",
  status: "open",
  is_spam: false,
  assigned_user_id: null,
  pinned_at: null,
  snoozed_until: null,
  snooze_kind: null,
  viewer_level: "text",
  contact: {
    id: "ct-1",
    name: "Dana Rivera",
    phone_e164: PHONE,
    address: null,
    notes: null,
    consent_source: null,
    consent_at: null,
    deleted_at: null,
  },
  tags: [],
  messages: { data: [], next_cursor: null },
  destination_clock: null,
} as unknown as ConversationDetail;

function renderHeader() {
  return render(
    <ThreadHeader
      conversation={CONVERSATION}
      contact={undefined}
      onToggleContactPanel={vi.fn()}
      panelOpen={false}
      onOpenGallery={vi.fn()}
      filter={ALL_CATEGORIES_ON}
      onFilterChange={vi.fn()}
    />,
  );
}

function openOverflow() {
  const trigger = screen.getByLabelText("More actions");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

beforeEach(() => {
  blockMutate.mockReset();
  unblockMutate.mockReset();
  rows.current = [];
  role.current = "member";
});

describe("ThreadHeader block / unblock", () => {
  it("offers Block number, and confirms before blocking", () => {
    renderHeader();
    openOverflow();
    fireEvent.click(screen.getByText("Block number"));

    expect(blockMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Future texts and calls from this number go straight to spam. You can still text them.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(blockMutate.mock.calls[0][0]).toBe(PHONE);
  });

  it("offers Unblock number on a blocked thread, and marks the thread blocked", () => {
    rows.current = [{ id: "b-1", phone_e164: PHONE }];
    renderHeader();
    expect(screen.getByLabelText("Blocked")).toBeTruthy();
    openOverflow();
    expect(screen.queryByText("Block number")).toBeNull();
    fireEvent.click(screen.getByText("Unblock number"));
    expect(unblockMutate.mock.calls[0][0]).toBe("b-1");
  });

  it("shows no blocked mark on an ordinary thread", () => {
    renderHeader();
    expect(screen.queryByLabelText("Blocked")).toBeNull();
  });

  it("hides the action from a role that may not mark spam", () => {
    role.current = "read_only";
    renderHeader();
    openOverflow();
    expect(screen.queryByText("Block number")).toBeNull();
  });
});
