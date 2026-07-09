import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactDetail } from "@/lib/api/types";

/**
 * #73: the contact detail screen gains a "Message" action so a user can start
 * texting a known contact without retyping their number — it routes to the
 * compose flow with the recipient prefilled (/inbox/new?contact=<id>).
 */
const state = {
  contact: null as unknown as ContactDetail,
  conversations: undefined as unknown,
};

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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useContact: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: state.contact,
    refetch: vi.fn(),
  }),
  useUpdateContact: () => ({ isPending: false, mutate: vi.fn() }),
  useOptOutContact: () => ({ isPending: false, mutate: vi.fn() }),
  useRevokeOptOut: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteContact: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/conversations", () => ({
  useConversations: () => ({ data: state.conversations }),
}));

import ContactDetailPage from "./page";

function contact(overrides: Partial<ContactDetail> = {}): ContactDetail {
  return {
    id: "c-1",
    phone_e164: "+12125550123",
    name: "Dana Rivera",
    address: null,
    notes: null,
    opted_out: false,
    consent_source: null,
    consent_at: null,
    consent_attested_by: null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as unknown as ContactDetail;
}

// A pre-resolved thenable so `use(params)` returns synchronously under
// renderToStaticMarkup (React reads status/value without suspending).
function render(id = "c-1"): string {
  const params = {
    status: "fulfilled",
    value: { id },
    then: () => {},
  } as unknown as Promise<{ id: string }>;
  return renderToStaticMarkup(<ContactDetailPage params={params} />);
}

beforeEach(() => {
  state.contact = contact();
  state.conversations = undefined; // no existing conversation by default
});

describe("/contacts/[id] Message action (#73)", () => {
  it("offers a Message action that prefills compose with this contact", () => {
    const html = render("c-1");
    expect(html).toContain("Message");
    expect(html).toContain('href="/inbox/new?contact=c-1"');
  });

  it("keeps the Message action available for an opted-out contact", () => {
    // The composer's own opt-out banner does the honest gating; the entry point
    // stays so the user can still open the (blocked) thread and see why.
    state.contact = contact({ opted_out: true });
    const html = render("c-1");
    expect(html).toContain('href="/inbox/new?contact=c-1"');
    expect(html).toContain("Opted out");
  });

  it("opens the existing conversation instead of composing (#82)", () => {
    state.conversations = {
      pages: [{ data: [{ id: "conv-9", status: "open" }], next_cursor: null }],
      pageParams: [],
    };
    const html = render("c-1");
    expect(html).toContain('href="/inbox/conv-9"');
    expect(html).toContain("Open conversation");
    expect(html).not.toContain("/inbox/new?contact=c-1");
  });
});
