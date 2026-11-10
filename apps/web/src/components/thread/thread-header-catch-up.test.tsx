/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationDetail } from "@/lib/api/types";

import { ALL_CATEGORIES_ON } from "./thread-filter";

afterEach(cleanup);

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
  useBlockedSenders: () => ({ data: { data: [] } }),
  useBlockSender: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockSender: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", userId: "u-1", role: "member" }),
}));

import { ThreadHeader } from "./thread-header";

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
} as unknown as ConversationDetail;

function renderHeader(onCatchUp?: () => void) {
  render(
    <ThreadHeader
      conversation={CONVERSATION}
      contact={undefined}
      onToggleContactPanel={vi.fn()}
      panelOpen={false}
      onOpenGallery={vi.fn()}
      filter={ALL_CATEGORIES_ON}
      onFilterChange={vi.fn()}
      onCatchUp={onCatchUp}
    />,
  );
  fireEvent.pointerDown(screen.getByLabelText("More actions"), {
    button: 0,
    ctrlKey: false,
  });
}

/**
 * #716: the composer's hint can be dismissed, so the header menu is where a
 * catch-up stays reachable. Only where the thread offers one: a menu item that
 * leads to "nothing to summarise" is the dead control the offer rule prevents.
 */
describe("ThreadHeader catch-up", () => {
  it("lists Catch me up when the thread offers one, and asks on select", () => {
    const onCatchUp = vi.fn();
    renderHeader(onCatchUp);
    fireEvent.click(screen.getByText("Catch me up"));
    expect(onCatchUp).toHaveBeenCalledTimes(1);
  });

  it("sits in the triage group, right after Mark unread", () => {
    renderHeader(vi.fn());
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.indexOf("Catch me up")).toBe(items.indexOf("Mark unread") + 1);
  });

  it("is absent when the thread does not offer one", () => {
    renderHeader(undefined);
    expect(screen.getByText("Mark unread")).toBeTruthy();
    expect(screen.queryByText("Catch me up")).toBeNull();
  });
});
