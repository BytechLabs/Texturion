/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationDetail } from "@/lib/api/types";

import { ALL_CATEGORIES_ON } from "./thread-filter";

afterEach(cleanup);

const muteMutate = vi.fn();
const unmuteMutate = vi.fn();
const followMutate = vi.fn();

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
  useMuteConversation: () => ({ mutate: muteMutate, isPending: false }),
  useUnmuteConversation: () => ({ mutate: unmuteMutate, isPending: false }),
  useFollowConversation: () => ({ mutate: followMutate, isPending: false }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useOptOutContact: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeOptOut: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/blocked-senders", () => ({
  useBlockedSenders: () => ({ data: { data: [] } }),
  useBlockSender: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockSender: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", userId: "u-1", role: "member" }),
}));

import { ThreadHeader } from "./thread-header";

function conversation(extra: Record<string, unknown> = {}) {
  return {
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
      phone_e164: "+12125550123",
      address: null,
      notes: null,
      consent_source: null,
      consent_at: null,
      deleted_at: null,
    },
    tags: [],
    messages: { data: [], next_cursor: null },
    destination_clock: null,
    ...extra,
  } as unknown as ConversationDetail;
}

function renderHeader(extra: Record<string, unknown> = {}) {
  return render(
    <ThreadHeader
      conversation={conversation(extra)}
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
  fireEvent.pointerDown(screen.getByLabelText("More actions"), {
    button: 0,
    ctrlKey: false,
  });
}

beforeEach(() => {
  muteMutate.mockReset();
  unmuteMutate.mockReset();
  followMutate.mockReset();
});

describe("ThreadHeader mute and follow", () => {
  it("offers Follow, and follows the thread", () => {
    renderHeader();
    openOverflow();
    fireEvent.click(screen.getByText("Follow conversation"));
    expect(followMutate.mock.calls[0][0]).toEqual({
      conversationId: "conv-1",
      follow: true,
    });
  });

  it("offers Stop following on a followed thread", () => {
    renderHeader({ followed: true });
    openOverflow();
    fireEvent.click(screen.getByText("Stop following"));
    expect(followMutate.mock.calls[0][0]).toEqual({
      conversationId: "conv-1",
      follow: false,
    });
  });

  it("shows no muted mark on an ordinary thread", () => {
    renderHeader();
    expect(screen.queryByTitle("Muted")).toBeNull();
  });

  it("marks a muted thread and offers Unmute instead of the durations", () => {
    renderHeader({ muted: true, muted_until: null });
    expect(screen.getByLabelText("Muted until you unmute")).toBeTruthy();
    openOverflow();
    expect(screen.queryByText("Mute notifications")).toBeNull();
    fireEvent.click(screen.getByText("Unmute notifications"));
    expect(unmuteMutate.mock.calls[0][0]).toEqual({ conversationId: "conv-1" });
  });

  it("offers the Mute submenu on an unmuted thread", () => {
    renderHeader();
    openOverflow();
    expect(screen.getByText("Mute notifications")).toBeTruthy();
    expect(screen.queryByText("Unmute notifications")).toBeNull();
  });
});
