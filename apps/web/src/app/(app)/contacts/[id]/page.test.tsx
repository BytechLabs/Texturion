import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactDetail } from "@/lib/api/types";

/**
 * #73: the contact detail screen gains a "Message" action so a user can start
 * texting a known contact without retyping their number — it routes to the
 * compose flow with the recipient prefilled (/inbox/new?contact=<id>).
 */
const blockedRows = { current: [] as { id: string; phone_e164: string }[] };

const state = {
  contact: null as unknown as ContactDetail,
  conversations: undefined as unknown,
  query: "",
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
  usePathname: () => "/contacts/c-1",
  useSearchParams: () => new URLSearchParams(state.query),
}));
// #740: the lists behind the tabs. Each stub names itself so a test can tell
// which list is on screen; the rows are theirs to test.
vi.mock("@/components/inbox/conversation-row", () => ({
  ConversationRow: () => <li>conversation-row</li>,
}));
vi.mock("@/components/calls/call-row", () => ({
  CallRow: () => <li>call-row</li>,
}));
vi.mock("@/lib/api/gallery", () => ({
  useAttachmentGallery: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
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
  // #291: the address list mounts under the address field. No rows and no
  // pending writes, so it renders its "Add another address" affordance and
  // these assertions stay about the record above it.
  useAddContactAddress: () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  }),
  useUpdateContactAddress: () => ({ isPending: false, mutate: vi.fn() }),
  useRemoveContactAddress: () => ({ isPending: false, mutate: vi.fn() }),
  // #291: the phone list mounts at the top of the record. No rows and no
  // pending writes, so it renders its "Add another number" affordance and
  // these assertions stay about the record below it.
  useAddContactPhone: () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  }),
  useRemoveContactPhone: () => ({ isPending: false, mutate: vi.fn() }),
  useOptOutContact: () => ({ isPending: false, mutate: vi.fn() }),
  useRevokeOptOut: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteContact: () => ({ isPending: false, mutate: vi.fn() }),
  // #695: tags on the customer, and the way back from a merge.
  useAddContactTag: () => ({ isPending: false, mutate: vi.fn() }),
  useRemoveContactTag: () => ({ isPending: false, mutate: vi.fn() }),
  useUnmergeContact: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({ data: { data: [] } }),
}));
// #291: the page mounts ContactCustomFields, whose hook reaches
// CompanyProvider — which this static-render harness does not set up. An empty
// definition list is the state for every workspace that has not defined any,
// and it makes the component render nothing, which is what these assertions
// about the record above it assume.
// #304: the manage card now offers a history export, which asks the active
// company for the caller's role — the first thing on this page to reach
// CompanyProvider directly, which this static-render harness does not set up.
// Owner, so the control renders and the assertions below see the page a
// permitted reader sees.
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "company-1",
  useActiveCompany: () => ({ role: "owner" }),
}));
// #696: the block list. A contact whose number is on it says so and offers
// the way back; every other contact offers the block.
vi.mock("@/lib/api/blocked-senders", () => ({
  useBlockedSenders: () => ({ data: { data: blockedRows.current } }),
  useBlockSender: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockSender: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Its request hook reaches the provider too. Not pending and never called — these
// assertions are about the record above it.
vi.mock("@/lib/api/exports", () => ({
  useExportContactHistory: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/contact-fields", () => ({
  useContactFields: () => ({ isPending: false, data: { data: [], cap: 10 } }),
  useSaveContactFields: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/conversations", () => ({
  useConversations: () => ({
    data: state.conversations,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
// #133: the page mounts CallButton — stub the hook chain so the module graph
// never reaches src/env.ts (which throws without NEXT_PUBLIC_* vars).
// #134/D42: no 'voice' in enabled_modules — calling is included on every
// plan and the button no longer reads module state at all.
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: { enabled_modules: [] },
  }),
}));
// #714: the activity timeline hook reaches CompanyProvider, which this harness
// deliberately does not mount (the page is rendered bare).
vi.mock("@/lib/api/record-activity", () => ({
  useRecordActivity: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
// #690: the linked-tasks list is its own query; this harness mounts no client.
vi.mock("@/lib/api/task-links", () => ({
  useLinkedTasks: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/calls", () => ({
  useCalls: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useVoicemailUrl: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
  }),
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
    created_by_user_id: null,
    created_by_name: null,
    updated_by_user_id: null,
    updated_by_name: null,
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
  state.query = "";
  blockedRows.current = [];
});

describe("/contacts/[id] tags and unmerge (#695)", () => {
  it("shows the tags the customer carries, each with a way to remove it", () => {
    state.contact = contact({
      tags: [
        { id: "t-1", name: "Property manager", color: null },
        { id: "t-2", name: "Warranty", color: null },
      ],
    });
    const html = render("c-1");
    expect(html).toContain("Property manager");
    expect(html).toContain("Remove tag Warranty");
    expect(html).toContain("Add a tag");
  });

  it("says what was merged in, and offers Unmerge to someone who can merge", () => {
    state.contact = contact({
      merged_from: {
        id: "c-2",
        name: "Jane Smith",
        phone_e164: "+12125550199",
        merged_at: "2026-11-02T15:00:00Z",
      },
    });
    const html = render("c-1");
    expect(html).toContain("Merged from Jane Smith");
    expect(html).toContain("Unmerge");
  });

  it("says nothing about a merge when none happened", () => {
    expect(render("c-1")).not.toContain("Merged from");
  });
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

describe("/contacts/[id] record attribution (#191)", () => {
  it("shows who added the contact when the name resolves", () => {
    state.contact = contact({
      created_by_name: "Sam Cortez",
      created_at: "2026-07-01T00:00:00Z",
    });
    const html = render("c-1");
    expect(html).toContain("Added by Sam Cortez on");
  });

  it("shows nothing when the actor name is null (older contact)", () => {
    state.contact = contact({ created_by_name: null, updated_by_name: null });
    const html = render("c-1");
    expect(html).not.toContain("Added by");
    expect(html).not.toContain("Edited by");
  });

  it("adds an edited line only when a different member last edited it", () => {
    state.contact = contact({
      created_by_name: "Sam Cortez",
      updated_by_name: "Dana Rivera",
    });
    const html = render("c-1");
    expect(html).toContain("Added by Sam Cortez on");
    expect(html).toContain("Edited by Dana Rivera");
  });

  it("omits the edited line when the same member added and last edited it", () => {
    state.contact = contact({
      created_by_name: "Sam Cortez",
      updated_by_name: "Sam Cortez",
    });
    const html = render("c-1");
    expect(html).toContain("Added by Sam Cortez on");
    expect(html).not.toContain("Edited by");
  });
});

describe("/contacts/[id] activity (#714)", () => {
  it("shows the one activity timeline in place of the History and Call history cards", () => {
    const html = render("c-1");
    expect(html).toContain("Activity");
    for (const filter of ["All", "Messages", "Calls", "Changes"]) expect(html).toContain(filter);
    expect(html).not.toContain("Call history");
  });
});

describe("/contacts/[id] block number (#696)", () => {
  it("offers Block number, and says what it does", () => {
    const html = render("c-1");
    expect(html).toContain("Block number");
    expect(html).not.toContain("Unblock number");
  });

  it("offers Unblock number and marks a contact whose number is blocked", () => {
    blockedRows.current = [{ id: "b-1", phone_e164: "+12125550123" }];
    const html = render("c-1");
    expect(html).toContain("Unblock number");
    expect(html).toContain("Blocked");
  });
});

describe("/contacts/[id] sections (#740)", () => {
  const withThreads = () => {
    state.conversations = {
      pages: [{ data: [{ id: "conv-9", status: "open" }], next_cursor: null }],
      pageParams: [],
    };
  };
  const tabs = ["activity", "conversations", "calls", "tasks", "files"] as const;
  const marks = {
    activity: "Messages",
    conversations: "conversation-row",
    calls: "No calls yet",
    tasks: "No tasks yet",
    files: "Photos and files shared",
  };

  it("offers every section as a tab, on a phone and on a desktop", () => {
    const html = render("c-1");
    for (const label of ["Details", "Activity", "Conversations", "Calls", "Tasks", "Files"]) {
      expect(html).toContain(label);
    }
  });

  it("shows one list at a time, whichever tab the link names", () => {
    withThreads();
    for (const tab of tabs) {
      state.query = `tab=${tab}`;
      const html = render("c-1");
      expect(html, tab).toContain(marks[tab]);
      for (const other of tabs.filter((name) => name !== tab)) {
        if (other === "activity") continue;
        expect(html, `${tab} hides ${other}`).not.toContain(marks[other]);
      }
      // The timeline is the only list with its own filter row.
      if (tab !== "activity") expect(html).not.toContain("Changes");
    }
  });

  it("keeps the details column on screen beside any tab", () => {
    state.query = "tab=calls";
    expect(render("c-1")).toContain("contact-name");
  });

  it("hides empty detail fields behind Add details", () => {
    const html = render("c-1");
    expect(html).toContain("Add details");
    expect(html).toContain("contact-name");
    for (const id of ["contact-business", "contact-address", "contact-email", "contact-notes"]) {
      expect(html).not.toContain(id);
    }
  });

  it("shows the fields that are filled, and no Add details when none is empty", () => {
    state.contact = contact({
      business_name: "Maple Property Group",
      address: "12 Elm St",
      email: "dana@example.com",
      notes: "Gate code 4411",
    });
    const html = render("c-1");
    expect(html).not.toContain("Add details");
    for (const id of ["contact-business", "contact-address", "contact-email", "contact-notes"]) {
      expect(html).toContain(id);
    }
  });

  it("keeps the header actions, tags and consent reachable on every tab", () => {
    for (const query of ["", "tab=files", "tab=calls"]) {
      state.query = query;
      const html = render("c-1");
      expect(html).toContain("Message");
      expect(html).toContain("Add a tag");
      expect(html).toContain("Consent");
      expect(html).toContain("Block number");
    }
  });
});
