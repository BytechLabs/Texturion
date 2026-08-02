import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContactDetail, ConversationDetail } from "@/lib/api/types";

import { ALL_CATEGORIES_ON } from "./thread-filter";

/**
 * #505 — the repeat-customer badge in the thread header.
 *
 * The WORDING is `contactRepeatBadge`'s, asserted once in packages/shared for
 * all three clients. What is asserted here is what only this component can get
 * wrong: which of the header's two inputs it reads, and that the quiet case
 * really is quiet. That last one is the whole feature — a header that decorates
 * every thread distinguishes nobody, and `conversation_count` includes the open
 * conversation, so every first-time caller reads exactly 1.
 */

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkConversationUnread: () => ({ mutate: vi.fn(), isPending: false }),
  useSnoozeConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useUnsnoozeConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useOptOutContact: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeOptOut: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co-1", userId: "u-1", role: "owner" }),
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

/** Only the two fields the header reads off the contact detail. */
function contact(conversationCount: number | null): ContactDetail {
  return {
    id: "ct-1",
    phone_e164: "+12125550123",
    name: "Dana Rivera",
    opted_out: false,
    opt_out_source: null,
    conversation_count: conversationCount,
    first_conversation_at: "2026-03-04T10:00:00Z",
  } as unknown as ContactDetail;
}

function render(loaded: ContactDetail | undefined) {
  return renderToStaticMarkup(
    <ThreadHeader
      conversation={CONVERSATION}
      contact={loaded}
      onToggleContactPanel={vi.fn()}
      panelOpen={false}
      onOpenGallery={vi.fn()}
      filter={ALL_CATEGORIES_ON}
      onFilterChange={vi.fn()}
    />,
  );
}

describe("#505 ThreadHeader repeat-customer badge", () => {
  it("says nothing about a first-time caller", () => {
    // THE case. Their one conversation is the one already on screen, so a
    // count here would be a badge on every thread in the inbox.
    const html = render(contact(1));
    expect(html).not.toContain("1 conversation");
    // Asserted on the chip itself, not just the words: the header's own
    // "Show conversation info" control means a bare substring match on
    // "conversation" would pass whatever this component rendered.
    expect(html).not.toContain('data-slot="badge"');
    // And the header is otherwise exactly what it always was.
    expect(html).toContain("Dana Rivera");
  });

  it("shows the count to somebody replying to a repeat customer", () => {
    const html = render(contact(7));
    expect(html).toContain("7 conversations");
    expect(html).toContain('data-slot="badge"');
    // The count only — the date belongs to the panel, which is the surface
    // somebody opens to READ. This one is glanced at mid-reply.
    expect(html).not.toContain("Customer since");
    expect(html).not.toContain("March 2026");
  });

  it("shows nothing while the contact is still loading", () => {
    // The header renders from the conversation long before the contact detail
    // lands. Guessing a count would be worse than waiting for one.
    expect(render(undefined)).not.toContain('data-slot="badge"');
  });

  it("keeps the name and every control it already had", () => {
    // The badge sits beside the name, so the failure worth pinning is it
    // crowding out the things somebody came to the header to press.
    const html = render(contact(7));
    expect(html).toContain("Dana Rivera");
    expect(html).toContain("Call Dana Rivera from your business number");
    expect(html).toContain("Change status");
    expect(html).toContain("More actions");
  });
});
