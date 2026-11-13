/**
 * @vitest-environment happy-dom
 */
/**
 * The thread pane opens from what the inbox already holds: the clicked row
 * draws the header while the detail loads, a failed background refetch leaves
 * the open thread alone, and an open that changes nothing on the server sends
 * no POST /read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/lib/api/keys";
import { ApiError } from "@/lib/api/error";
import type {
  ConversationDetail,
  ConversationListItem,
  Message,
} from "@/lib/api/types";

const COMPANY_ID = "co-1";
const VIEWER_ID = "u-1";
const TEAMMATE_ID = "u-2";
const CONVERSATION_ID = "conv-1";

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  markRead: vi.fn(),
  readCoveredThrough: vi.fn<(id: string, userId: string) => string | undefined>(),
  useMessages: vi.fn(),
  useUsage: vi.fn<(options?: { enabled?: boolean }) => { data: undefined }>(() => ({
    data: undefined,
  })),
  role: { current: "owner" },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    companyId: COMPANY_ID,
    userId: VIEWER_ID,
    role: mocks.role.current,
  }),
}));
vi.mock("@/lib/api/conversations", () => ({
  useConversation: mocks.useConversation,
  useMarkConversationRead: () => ({ mutate: mocks.markRead }),
  readCoveredThrough: mocks.readCoveredThrough,
}));
vi.mock("@/lib/api/messages", () => ({ useMessages: mocks.useMessages }));
vi.mock("@/lib/api/usage", () => ({ useUsage: mocks.useUsage }));
vi.mock("@/lib/api/me", () => ({
  useMe: () => ({ data: { user_id: VIEWER_ID, display_name: "Robin" } }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: { data: [{ user_id: TEAMMATE_ID, display_name: "Sam Ortiz" }] },
  }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useContact: () => ({ data: undefined, isPending: true }),
}));
vi.mock("@/lib/api/companies", () => ({ useCompany: () => ({ data: undefined }) }));
vi.mock("@/lib/realtime/presence", () => ({
  useConversationPresence: () => ({ viewers: [], onTyping: vi.fn() }),
}));
vi.mock("@/lib/use-is-xl", () => ({ useIsXl: () => false }));
vi.mock("./use-catch-up", () => ({
  useCatchUp: () => ({
    offered: false,
    askToken: 0,
    newestMessageId: undefined,
    hintShown: false,
    ask: vi.fn(),
    notNow: vi.fn(),
    recapClosed: vi.fn(),
  }),
}));
vi.mock("@/components/thread/panel-width", () => ({
  usePanelWidth: () => ({
    width: 300,
    widthRef: { current: 300 },
    resize: vi.fn(),
    commit: vi.fn(),
  }),
  PanelResizeHandle: () => null,
  PanelOverflowMenu: () => null,
}));
vi.mock("./thread-header", () => ({
  ThreadHeader: ({ conversation }: { conversation: ConversationDetail }) => (
    <header data-testid="thread-header">{conversation.contact.name}</header>
  ),
}));
vi.mock("./message-list", () => ({ MessageList: () => <div data-testid="message-list" /> }));
vi.mock("./composer", () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock("./composer-banners", () => ({ ComposerBannerCard: () => null }));
vi.mock("./alert-banner", () => ({ AlertBanner: () => null }));
vi.mock("./scheduled-strip", () => ({ ScheduledStrip: () => null }));
vi.mock("./their-time", () => ({ TheirTime: () => null }));
vi.mock("./attachments-gallery", () => ({ AttachmentsGallery: () => null }));
vi.mock("@/components/thread/presence-strip", () => ({ PresenceStrip: () => null }));
vi.mock("@/components/thread/spam-suspected-banner", () => ({
  SpamSuspectedBanner: () => null,
}));
vi.mock("@/components/contact-panel/contact-panel", () => ({ ContactPanel: () => null }));
vi.mock("@/components/tasks/task-detail-panel", () => ({ TaskDetailPanel: () => null }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: () => null,
  SheetContent: () => null,
  SheetDescription: () => null,
  SheetHeader: () => null,
  SheetTitle: () => null,
}));

import { ThreadView } from "./thread-view";

const CONVERSATION_FIELDS = {
  id: CONVERSATION_ID,
  company_id: COMPANY_ID,
  contact_id: "ct-1",
  phone_number_id: "num-1",
  status: "open",
  is_spam: false,
  assigned_user_id: TEAMMATE_ID,
  pinned_at: null,
  pinned_by_user_id: null,
  last_message_at: "2026-11-13T10:00:00.000Z",
  closed_at: null,
  emergency_at: null,
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-13T10:00:00.000Z",
} as const;

function listRow(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    ...CONVERSATION_FIELDS,
    contact: { id: "ct-1", name: "Dana Rivera", phone_e164: "+12125550123" },
    tags: [],
    unread: false,
    last_message: null,
    ...overrides,
  } as ConversationListItem;
}

function message(overrides: Partial<Message>): Message {
  return {
    id: "m-1",
    conversation_id: CONVERSATION_ID,
    direction: "inbound",
    body: "Can you come Tuesday?",
    status: "received",
    segments: 1,
    encoding: "GSM-7",
    sent_by_user_id: null,
    error_code: null,
    error_detail: null,
    telnyx_message_id: null,
    done_at: null,
    done_by_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    created_at: "2026-11-13T10:00:00.000Z",
    attachments: [],
    quiet: false,
    ...overrides,
  } as Message;
}

const DETAIL = {
  ...CONVERSATION_FIELDS,
  contact: { id: "ct-1", name: "Dana Rivera", phone_e164: "+12125550123" },
  tags: [],
  messages: { data: [], next_cursor: null },
  destination_clock: null,
  viewer_level: "text",
  open_alert: null,
} as unknown as ConversationDetail;

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    data: DETAIL,
    isPending: false,
    isError: false,
    isLoadingError: false,
    isRefetchError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function windowIs(newestFirst: Message[], extra: { hasPreviousPage?: boolean } = {}) {
  mocks.useMessages.mockReturnValue({
    data: { pages: [{ data: newestFirst, next_cursor: null }], pageParams: [undefined] },
    hasPreviousPage: extra.hasPreviousPage ?? false,
  });
}

function newestIs(newest: Message, extra: { hasPreviousPage?: boolean } = {}) {
  windowIs([newest], extra);
}

let queryClient: QueryClient;

function cacheRow(row: ConversationListItem) {
  queryClient.setQueryData(keys.conversations.list(COMPANY_ID, {}), {
    pages: [{ data: [row], next_cursor: null }],
    pageParams: [undefined],
  });
}

function renderThread() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThreadView conversationId={CONVERSATION_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  mocks.role.current = "owner";
  mocks.markRead.mockReset();
  mocks.readCoveredThrough.mockReset();
  mocks.readCoveredThrough.mockReturnValue(undefined);
  mocks.useUsage.mockClear();
  newestIs(message({}));
});

afterEach(() => {
  cleanup();
});

describe("while the detail loads", () => {
  beforeEach(() => {
    mocks.useConversation.mockReturnValue({ isPending: true, isError: false });
  });

  it("draws the header from the clicked inbox row, with nothing that can send", () => {
    cacheRow(listRow());
    const { container } = renderThread();

    expect(screen.getByText("Dana Rivera")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(container.querySelector('[data-initials="SO"]')).not.toBeNull();
    expect(screen.queryByTestId("composer")).toBeNull();
    expect(screen.queryByTestId("message-list")).toBeNull();
    expect(container.querySelector("textarea, input")).toBeNull();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("shows the number for an unnamed contact", () => {
    cacheRow(listRow({ contact: { id: "ct-1", name: null, phone_e164: "+12125550123" } }));
    renderThread();

    expect(screen.getByText("(212) 555-0123")).toBeTruthy();
  });

  it("falls back to the skeleton when no row is cached", () => {
    const { container } = renderThread();

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
});

describe("a failed read", () => {
  it("keeps the open thread when a background refetch fails", () => {
    mocks.useConversation.mockReturnValue(
      loaded({
        isError: true,
        isRefetchError: true,
        error: new ApiError("internal_error", "Something broke.", 500),
      }),
    );
    renderThread();

    expect(screen.getByTestId("thread-header").textContent).toBe("Dana Rivera");
    expect(screen.queryByText("We couldn't load this conversation.")).toBeNull();
  });

  it("blocks when the first load fails", () => {
    mocks.useConversation.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isLoadingError: true,
      error: new ApiError("internal_error", "Something broke.", 500),
      refetch: vi.fn(),
    });
    renderThread();

    expect(screen.getByText("We couldn't load this conversation.")).toBeTruthy();
    expect(screen.queryByTestId("thread-header")).toBeNull();
  });

  it("blocks when a refetch says the conversation is gone", () => {
    mocks.useConversation.mockReturnValue(
      loaded({
        isError: true,
        isRefetchError: true,
        error: new ApiError("not_found", "No such conversation.", 404),
      }),
    );
    renderThread();

    expect(screen.getByText("This conversation doesn't exist or was removed.")).toBeTruthy();
    expect(screen.queryByTestId("thread-header")).toBeNull();
  });
});

describe("mark read on open (G4)", () => {
  beforeEach(() => {
    mocks.useConversation.mockReturnValue(loaded());
  });

  it("skips the POST when the row is read and the newest message is the viewer's own", () => {
    cacheRow(listRow({ unread: false }));
    newestIs(message({ direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }));
    renderThread();

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("skips the POST when this tab already read past the newest message", () => {
    cacheRow(listRow({ unread: false }));
    newestIs(message({ created_at: "2026-11-13T10:00:00.000Z" }));
    mocks.readCoveredThrough.mockReturnValue("2026-11-13T10:05:00.000Z");
    renderThread();

    expect(mocks.readCoveredThrough).toHaveBeenCalledWith(CONVERSATION_ID, VIEWER_ID);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("posts for an inbound message newer than the last read", () => {
    cacheRow(listRow({ unread: false }));
    newestIs(message({ created_at: "2026-11-13T10:10:00.000Z" }));
    mocks.readCoveredThrough.mockReturnValue("2026-11-13T10:05:00.000Z");
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("posts for a teammate's newest message the tab has not read", () => {
    cacheRow(listRow({ unread: false }));
    newestIs(message({ direction: "note", status: null, sent_by_user_id: TEAMMATE_ID }));
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("skips the POST when the viewer's own newest follows a customer's message", () => {
    cacheRow(listRow({ unread: false }));
    windowIs([
      message({ id: "m-2", direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }),
      message({ id: "m-1", created_at: "2026-11-13T09:00:00.000Z" }),
    ]);
    renderThread();

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("posts for a teammate's note the tab has not read under the viewer's own newest", () => {
    cacheRow(listRow({ unread: false }));
    windowIs([
      message({ id: "m-3", direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }),
      message({
        id: "m-2",
        direction: "note",
        status: null,
        sent_by_user_id: TEAMMATE_ID,
        created_at: "2026-11-13T09:30:00.000Z",
      }),
      message({ id: "m-1", created_at: "2026-11-13T09:00:00.000Z" }),
    ]);
    mocks.readCoveredThrough.mockReturnValue("2026-11-13T09:10:00.000Z");
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("posts for an automated reply the tab has not read under the viewer's own newest", () => {
    cacheRow(listRow({ unread: false }));
    windowIs([
      message({ id: "m-2", direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }),
      message({
        id: "m-1",
        direction: "outbound",
        status: "delivered",
        sent_by_user_id: null,
        created_at: "2026-11-13T09:30:00.000Z",
      }),
    ]);
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("skips the POST when the teammate's note under the viewer's newest is already read", () => {
    cacheRow(listRow({ unread: false }));
    windowIs([
      message({ id: "m-2", direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }),
      message({
        id: "m-1",
        direction: "note",
        status: null,
        sent_by_user_id: TEAMMATE_ID,
        created_at: "2026-11-13T09:30:00.000Z",
      }),
    ]);
    mocks.readCoveredThrough.mockReturnValue("2026-11-13T09:45:00.000Z");
    renderThread();

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("posts when the row is unread, even if the newest message is the viewer's own", () => {
    cacheRow(listRow({ unread: true }));
    newestIs(message({ direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }));
    mocks.readCoveredThrough.mockReturnValue("2026-11-13T10:05:00.000Z");
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("posts when no row is cached", () => {
    newestIs(message({ direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }));
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("posts when an anchored window stops short of the newest message", () => {
    cacheRow(listRow({ unread: false }));
    newestIs(
      message({ direction: "outbound", status: "delivered", sent_by_user_id: VIEWER_ID }),
      { hasPreviousPage: true },
    );
    renderThread();

    expect(mocks.markRead).toHaveBeenCalledWith(CONVERSATION_ID);
  });
});

describe("usage read", () => {
  beforeEach(() => {
    mocks.useConversation.mockReturnValue(loaded());
  });

  it("reads usage for a member who can see the cap", () => {
    renderThread();

    expect(mocks.useUsage).toHaveBeenCalledWith({ enabled: true });
  });

  it("does not read usage for a member the server sends no cap", () => {
    mocks.role.current = "member";
    renderThread();

    expect(mocks.useUsage).toHaveBeenCalledWith({ enabled: false });
  });
});
