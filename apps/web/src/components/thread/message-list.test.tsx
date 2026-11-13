/**
 * @vitest-environment happy-dom
 */
/**
 * A thread opens at its newest message before the first frame is drawn, so
 * the oldest rows of the window never mount and never mint attachment URLs. A
 * link that opens it at a message (#718) still owns the first position, and a
 * target that is gone falls back to the bottom.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/api/types";

import { ALL_CATEGORIES_ON } from "./thread-filter";

const SCROLL_HEIGHT = 4000;

const mocks = vi.hoisted(() => ({
  useMessages: vi.fn(),
  anchorId: { current: null as string | null },
}));

vi.mock("@/lib/api/messages", () => ({
  useMessages: mocks.useMessages,
  useThreadAnchor: () => mocks.anchorId.current,
  useConversationPinnedMessages: () => ({ data: [] }),
}));
vi.mock("@/lib/api/conversations", () => ({
  useConversationEvents: () => ({
    data: { pages: [{ data: [], next_cursor: null }], pageParams: [undefined] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isPending: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@/components/inbox/member-avatar", () => ({ useMemberNames: () => new Map() }));
vi.mock("./message-bubble", () => ({ MessageBubble: () => <div /> }));
vi.mock("./system-line", () => ({ DayDivider: () => <div />, SystemLine: () => <div /> }));
vi.mock("./thread-summary-card", () => ({ ThreadSummaryCard: () => null }));
vi.mock("./thread-filter-bar", () => ({ ThreadFilterBar: () => null }));
vi.mock("./anchor-missing-notice", () => ({ AnchorMissingNotice: () => null }));

import { MessageList } from "./message-list";

function message(overrides: Partial<Message>): Message {
  return {
    id: "m-1",
    conversation_id: "conv-1",
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

function threadOf(messages: Message[], page: { anchor_missing?: boolean } = {}) {
  mocks.useMessages.mockReturnValue({
    data: {
      pages: [{ data: [...messages].reverse(), next_cursor: null, ...page }],
      pageParams: [undefined],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingNextPage: false,
    isFetchingPreviousPage: false,
    fetchNextPage: vi.fn(),
    fetchPreviousPage: vi.fn(),
  });
}

const TWO_MESSAGES = [
  message({ id: "m-1", created_at: "2026-11-13T09:00:00.000Z" }),
  message({ id: "m-2", created_at: "2026-11-13T10:00:00.000Z" }),
];

function renderList() {
  render(
    <MessageList
      conversationId="conv-1"
      contact={{ name: "Dana Rivera", phone_e164: "+12125550123" }}
      filter={ALL_CATEGORIES_ON}
      onFilterChange={vi.fn()}
      catchUp={{ offered: false, askToken: 0, newestMessageId: undefined, onDismiss: vi.fn() }}
    />,
  );
  return screen.getByLabelText("Messages with Dana Rivera");
}

const scrollTops = new WeakMap<Element, number>();
const scrollTopWrites: number[] = [];

beforeEach(() => {
  mocks.anchorId.current = null;
  scrollTopWrites.length = 0;
  // A frame never comes, so only a scroll made before the first paint counts.
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(SCROLL_HEIGHT);
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return scrollTops.get(this) ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    value: number,
  ) {
    scrollTops.set(this, value);
    scrollTopWrites.push(value);
  });
});

afterEach(() => {
  cleanup();
});

describe("where a thread opens", () => {
  it("is at the newest message before the first frame", () => {
    threadOf(TWO_MESSAGES);
    const list = renderList();

    expect(list.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("is the bottom when the ?message= target is gone", () => {
    mocks.anchorId.current = "m-gone";
    threadOf(TWO_MESSAGES, { anchor_missing: true });
    const list = renderList();

    expect(list.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("is left to the #718 jump when a link opens it at a message", () => {
    mocks.anchorId.current = "m-1";
    threadOf(TWO_MESSAGES);
    renderList();

    expect(scrollTopWrites).not.toContain(SCROLL_HEIGHT);
  });
});

describe("row estimates", () => {
  it("count a message's pictures, audio and files", () => {
    threadOf([
      message({
        attachments: [
          { id: "a-1", content_type: "image/jpeg", size_bytes: 1 },
          { id: "a-2", content_type: "image/jpeg", size_bytes: 1 },
          { id: "a-3", content_type: "image/png", size_bytes: 1 },
          { id: "a-4", content_type: "image/gif", size_bytes: 1 },
          { id: "a-5", content_type: "audio/amr", size_bytes: 1 },
          { id: "a-6", content_type: "application/pdf", size_bytes: 1 },
        ],
      }),
    ]);
    const list = renderList();
    const track = list.querySelector<HTMLElement>("[style*='height']");

    // Day divider 36, then the cluster: 18 + 52 + two rows of pictures + audio + file.
    expect(track?.style.height).toBe(`${36 + 18 + 52 + 2 * 182 + 96 + 62}px`);
  });
});
