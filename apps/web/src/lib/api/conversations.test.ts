/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationListData } from "./cache";
import type { RequestOptions } from "./core";
import { ApiError } from "./error";
import type {
  Conversation,
  ConversationDetail,
  ConversationListItem,
  Page,
  Tag,
} from "./types";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

const COMPANY = "co-1";
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => COMPANY,
  useActiveCompany: () => ({ companyId: COMPANY, userId: "u-1", role: "owner" }),
}));

/** Every request the hooks make, held open until a test answers it. */
interface PendingCall {
  path: string;
  options: RequestOptions;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}
let calls: PendingCall[] = [];
const apiFetch = vi.fn(
  (path: string, options: RequestOptions = {}) =>
    new Promise((resolve, reject) => {
      calls.push({ path, options, resolve, reject });
    }),
);
vi.mock("./client", () => ({
  apiFetch: (path: string, options?: RequestOptions) => apiFetch(path, options),
}));

const {
  placeholderFromAllList,
  readCoveredThrough,
  useAttachTag,
  useConversation,
  useConversationPatch,
  useConversations,
  useDetachTag,
  useMarkConversationRead,
  useMarkConversationUnread,
  usePinnedConversations,
  usePrefetchConversation,
  useUpdateConversation,
} = await import("./conversations");
const { useSearch } = await import("./search");
const { keys } = await import("./keys");

const T1 = "2026-11-13T09:00:00.000Z";
const T2 = "2026-11-13T10:00:00.000Z";
const T3 = "2026-11-13T11:00:00.000Z";

function row(
  id: string,
  lastMessageAt: string,
  overrides: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id,
    company_id: COMPANY,
    contact_id: `contact-${id}`,
    phone_number_id: "number-1",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    emergency_at: null,
    last_message_at: lastMessageAt,
    closed_at: null,
    created_at: T1,
    updated_at: lastMessageAt,
    contact: { id: `contact-${id}`, name: `Contact ${id}`, phone_e164: "+14165550100" },
    tags: [],
    unread: false,
    last_message: null,
    ...overrides,
  } as ConversationListItem;
}

/** The detail response for a list row: no per-viewer unread, no snippet. */
function detailOf(item: ConversationListItem): ConversationDetail {
  const detail: Record<string, unknown> = {
    ...item,
    contact: {
      ...item.contact,
      address: null,
      notes: null,
      consent_source: null,
      consent_at: null,
      deleted_at: null,
    },
    messages: { data: [], next_cursor: null },
    destination_clock: null,
    viewer_level: "text",
    open_alert: null,
  };
  delete detail.unread;
  delete detail.last_message;
  return detail as unknown as ConversationDetail;
}

/** The bare conversations row PATCH answers with. */
function serverRow(item: ConversationListItem, fields: Partial<Conversation>): Conversation {
  const conversation: Record<string, unknown> = { ...item, ...fields };
  for (const key of ["contact", "tags", "unread", "last_message"]) delete conversation[key];
  return conversation as unknown as Conversation;
}

function pages(...rows: ConversationListItem[][]): ConversationListData {
  return {
    pages: rows.map((data) => ({ data, next_cursor: null })),
    pageParams: rows.map(() => undefined),
  };
}

function ids(data: ConversationListData | undefined): string[] {
  return (data?.pages ?? []).flatMap((page) => page.data.map((r) => r.id));
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const ALL = keys.conversations.list(COMPANY, {});
const OPEN = keys.conversations.list(COMPANY, { status: "open" });
const CLOSED = keys.conversations.list(COMPANY, { status: "closed" });
const SPAM = keys.conversations.list(COMPANY, { is_spam: true });
const PINNED_ALL = keys.conversations.pinned(COMPANY, {});
const PINNED_OPEN = keys.conversations.pinned(COMPANY, { status: "open" });
const DETAIL = keys.conversations.detail(COMPANY, "c1");

/** c1 open in the All, Open and both pinned caches; c2 open alongside it. */
function seedInbox(client: QueryClient, c1: ConversationListItem = row("c1", T3)) {
  const c2 = row("c2", T2);
  client.setQueryData(ALL, pages([c1, c2]));
  client.setQueryData(OPEN, pages([c1, c2]));
  client.setQueryData(CLOSED, pages([]));
  client.setQueryData(SPAM, pages([]));
  client.setQueryData(DETAIL, detailOf(c1));
  return { c1, c2 };
}

beforeEach(() => {
  calls = [];
  apiFetch.mockClear();
});
afterEach(cleanup);

describe("list placeholders from the unfiltered inbox", () => {
  it("offers the cached rows that match, and nothing where the unfiltered list cannot know", () => {
    const client = newClient();
    client.setQueryData(
      ALL,
      pages([
        row("c1", T3, { unread: true }),
        row("c2", T2, { status: "closed", closed_at: T2 }),
        row("c3", T1, { assigned_user_id: "u-1" }),
      ]),
    );

    expect(ids(placeholderFromAllList(client, COMPANY, { status: "open" }))).toEqual(["c1", "c3"]);
    expect(ids(placeholderFromAllList(client, COMPANY, { unread: true }))).toEqual(["c1"]);
    expect(placeholderFromAllList(client, COMPANY, { status: "open" })?.pages[0].next_cursor).toBeNull();

    expect(placeholderFromAllList(client, COMPANY, { q: "leak" })).toBeUndefined();
    expect(placeholderFromAllList(client, COMPANY, { is_spam: true })).toBeUndefined();
    expect(placeholderFromAllList(client, COMPANY, { snoozed: "only" })).toBeUndefined();
    expect(placeholderFromAllList(client, COMPANY, { snoozed: "all" })).toBeUndefined();
    expect(placeholderFromAllList(client, COMPANY, { assigned_user_id: "u-9" })).toBeUndefined();
    expect(placeholderFromAllList(newClient(), COMPANY, { status: "open" })).toBeUndefined();
  });

  it("shows them while the filtered list loads only when the caller asks", () => {
    const client = newClient();
    client.setQueryData(
      ALL,
      pages([row("c1", T3), row("c2", T2, { status: "closed", closed_at: T2 })]),
    );
    const wrapper = wrapperFor(client);

    const asked = renderHook(
      () => useConversations({ status: "open" }, { placeholderFromAll: true }),
      { wrapper },
    );
    expect(asked.result.current.isPlaceholderData).toBe(true);
    expect(ids(asked.result.current.data)).toEqual(["c1"]);
    expect(asked.result.current.hasNextPage).toBe(false);

    const plain = renderHook(() => useConversations({ status: "closed" }), { wrapper });
    expect(plain.result.current.data).toBeUndefined();
  });

  it("keeps the previous view's pins while the next loads, less the ones it rules out", async () => {
    const client = newClient();
    const { result, rerender } = renderHook(
      ({ filters }) => usePinnedConversations(filters),
      { wrapper: wrapperFor(client), initialProps: { filters: {} as { status?: "open" } } },
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () =>
      calls[0].resolve({
        data: [
          row("c1", T3, { pinned_at: T1 }),
          row("c2", T2, { pinned_at: T1, status: "closed", closed_at: T2 }),
        ],
        next_cursor: null,
      }),
    );
    await waitFor(() => expect(result.current.data?.data).toHaveLength(2));

    rerender({ filters: { status: "open" } });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.data.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("abort signals", () => {
  it("reach apiFetch for the list, pinned and search reads, and never for the detail", async () => {
    const client = newClient();
    const wrapper = wrapperFor(client);
    renderHook(() => useConversations({ status: "open" }), { wrapper });
    renderHook(() => usePinnedConversations({ status: "open" }), { wrapper });
    renderHook(() => useSearch("leak"), { wrapper });
    renderHook(() => useConversation("c1"), { wrapper });

    await waitFor(() => expect(calls).toHaveLength(4));
    const byPath = (path: string, pinned?: string) =>
      calls.find(
        (call) => call.path === path && call.options.searchParams?.pinned === pinned,
      )!;
    expect(byPath("/v1/conversations").options.signal).toBeInstanceOf(AbortSignal);
    expect(byPath("/v1/conversations", "only").options.signal).toBeInstanceOf(AbortSignal);
    expect(byPath("/v1/search").options.signal).toBeInstanceOf(AbortSignal);
    expect(byPath("/v1/conversations/c1").options.signal).toBeUndefined();
  });

  it("aborts the search a newer query replaced", async () => {
    const client = newClient();
    const { rerender } = renderHook(({ q }) => useSearch(q), {
      wrapper: wrapperFor(client),
      initialProps: { q: "le" },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ q: "leak" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.signal?.aborted).toBe(false);
  });
});

describe("usePrefetchConversation", () => {
  it("reads the detail once, seeds the thread, and never posts a read", async () => {
    const client = newClient();
    const { result } = renderHook(() => usePrefetchConversation(), {
      wrapper: wrapperFor(client),
    });
    const prefetch = result.current;

    void prefetch("c1");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].path).toBe("/v1/conversations/c1");
    expect(calls[0].options.method).toBeUndefined();
    const detail = detailOf(row("c1", T3));
    detail.messages = { data: [{ id: "m1", created_at: T3 } as never], next_cursor: null };
    await act(async () => calls[0].resolve(detail));

    await waitFor(() =>
      expect(client.getQueryData(keys.thread(COMPANY, "c1"))).toBeDefined(),
    );
    void prefetch("c1");
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(result.current).toBe(prefetch);
  });
});

describe("useUpdateConversation is optimistic", () => {
  it("moves a closed row out of Open at the click, and refetches the truth on a refusal", async () => {
    const client = newClient();
    const { c1 } = seedInbox(client, row("c1", T3, { pinned_at: T1, pinned_by_user_id: "u-2" }));
    client.setQueryData(PINNED_ALL, { data: [c1], next_cursor: null });
    client.setQueryData(PINNED_OPEN, { data: [c1], next_cursor: null });
    const onError = vi.fn();
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ status: "closed" }, { onError }));

    await waitFor(() => expect(ids(client.getQueryData(OPEN))).toEqual(["c2"]));
    expect(ids(client.getQueryData(CLOSED))).toEqual(["c1"]);
    expect(client.getQueryData<ConversationListData>(ALL)?.pages[0].data[0].status).toBe("closed");
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.status).toBe("closed");
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.closed_at).not.toBeNull();
    expect(client.getQueryData<Page<ConversationListItem>>(PINNED_OPEN)?.data).toEqual([]);
    expect(client.getQueryData<Page<ConversationListItem>>(PINNED_ALL)?.data[0].status).toBe("closed");
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ method: "PATCH", body: { status: "closed" } });

    await act(async () => calls[0].reject(new ApiError("forbidden", "No access to this number.", 403)));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    for (const key of [DETAIL, OPEN, CLOSED, ALL, PINNED_OPEN]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("runs a close and its Undo in order, and keeps the Undo on screen meanwhile", async () => {
    const client = newClient();
    const { c1 } = seedInbox(client);
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ status: "closed" }));
    await waitFor(() => expect(ids(client.getQueryData(OPEN))).toEqual(["c2"]));
    act(() => result.current.mutate({ status: "open" }));
    await waitFor(() => expect(ids(client.getQueryData(OPEN))).toEqual(["c1", "c2"]));
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.status).toBe("open");
    expect(calls).toHaveLength(1);

    await act(async () => calls[0].resolve(serverRow(c1, { status: "closed", closed_at: T3 })));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].options.body).toEqual({ status: "open" });
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.status).toBe("open");
    expect(ids(client.getQueryData(OPEN))).toEqual(["c1", "c2"]);

    await act(async () => calls[1].resolve(serverRow(c1, { status: "open", closed_at: null })));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.status).toBe("open");
    expect(ids(client.getQueryData(CLOSED))).toEqual([]);
  });

  it("marks spam as the server does: out of the inbox, into the spam view, closed", async () => {
    const client = newClient();
    seedInbox(client);
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ is_spam: true }));

    await waitFor(() => expect(ids(client.getQueryData(ALL))).toEqual(["c2"]));
    const spam = client.getQueryData<ConversationListData>(SPAM)?.pages[0].data[0];
    expect(spam).toMatchObject({ id: "c1", is_spam: true, status: "closed" });
  });

  it("assigns and unpins at the click", async () => {
    const client = newClient();
    const { c1 } = seedInbox(client, row("c1", T3, { pinned_at: T1, pinned_by_user_id: "u-2" }));
    client.setQueryData(PINNED_ALL, { data: [c1], next_cursor: null });
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ assigned_user_id: "u-7", pinned: false }));

    await waitFor(() =>
      expect(client.getQueryData<Page<ConversationListItem>>(PINNED_ALL)?.data).toEqual([]),
    );
    expect(client.getQueryData<ConversationDetail>(DETAIL)).toMatchObject({
      assigned_user_id: "u-7",
      pinned_at: null,
      pinned_by_user_id: null,
    });
    expect(client.getQueryData<ConversationListData>(OPEN)?.pages[0].data[0].assigned_user_id).toBe("u-7");
  });

  it("drops a list read that left before the click, and reads it again after the write", async () => {
    const client = newClient();
    const { c1, c2 } = seedInbox(client);
    const staleRead = client
      .fetchQuery({
        queryKey: OPEN,
        queryFn: () => apiFetch("/v1/conversations", {}) as Promise<ConversationListData>,
      })
      .catch(() => undefined);
    await waitFor(() => expect(calls).toHaveLength(1));
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ status: "closed" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => {
      calls[0].resolve(pages([c1, c2]));
      await staleRead;
    });
    expect(ids(client.getQueryData(OPEN))).toEqual(["c2"]);

    await act(async () => calls[1].resolve(serverRow(c1, { status: "closed", closed_at: T3 })));
    await waitFor(() => expect(client.getQueryState(OPEN)?.isInvalidated).toBe(true));
    expect(client.getQueryState(ALL)?.isInvalidated).toBe(false);
  });

  it("leaves the list untouched when the server row equals the optimistic one", async () => {
    const client = newClient();
    const { c1 } = seedInbox(client);
    const { result } = renderHook(() => useUpdateConversation("c1"), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current.mutate({ assigned_user_id: "u-7" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const optimistic = client.getQueryData(OPEN);
    await act(async () => calls[0].resolve(serverRow(c1, { assigned_user_id: "u-7" })));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryData(OPEN)).toBe(optimistic);
  });
});

describe("useConversationPatch", () => {
  it("names the conversation per call and queues behind the thread's own edits", async () => {
    const client = newClient();
    const { c1 } = seedInbox(client);
    const wrapper = wrapperFor(client);
    const thread = renderHook(() => useUpdateConversation("c1"), { wrapper });
    const inbox = renderHook(() => useConversationPatch(), { wrapper });
    const onSuccess = vi.fn();

    act(() => thread.result.current.mutate({ status: "closed" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => inbox.result.current.mutate({ id: "c1", patch: { status: "open" } }, { onSuccess }));
    await waitFor(() => expect(ids(client.getQueryData(OPEN))).toEqual(["c1", "c2"]));
    expect(calls).toHaveLength(1);

    await act(async () => calls[0].resolve(serverRow(c1, { status: "closed", closed_at: T3 })));
    await waitFor(() => expect(calls).toHaveLength(2));
    const reopened = serverRow(c1, { status: "open" });
    await act(async () => calls[1].resolve(reopened));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(reopened));
  });

  it("reports a refusal to the caller and reconciles", async () => {
    const client = newClient();
    seedInbox(client);
    const { result } = renderHook(() => useConversationPatch(), {
      wrapper: wrapperFor(client),
    });
    const onError = vi.fn();

    act(() => result.current.mutate({ id: "c1", patch: { status: "closed" } }, { onError }));
    await waitFor(() => expect(ids(client.getQueryData(OPEN))).toEqual(["c2"]));
    await act(async () => calls[0].reject(new ApiError("conflict", "No.", 409)));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(client.getQueryState(OPEN)?.isInvalidated).toBe(true);
  });
});

describe("useMarkConversationRead", () => {
  const RECEIPT_AT = "2026-11-13T12:00:00.000Z";
  const FOR_YOU = keys.forYou(COMPANY);

  function setup(rows: ConversationListItem[]) {
    const client = newClient();
    client.setQueryData(ALL, pages(rows));
    client.setQueryData(PINNED_ALL, { data: rows.filter((r) => r.pinned_at), next_cursor: null });
    client.setQueryData(FOR_YOU, { sections: [] });
    const wrapper = wrapperFor(client);
    const read = renderHook(() => useMarkConversationRead(), { wrapper });
    const unread = renderHook(() => useMarkConversationUnread(), { wrapper });
    return { client, read, unread };
  }

  it("remembers the receipt, refreshes the queue for a row it flipped, and forgets on unread", async () => {
    const { client, read, unread } = setup([row("r1", T3, { unread: true })]);

    act(() => read.result.current.mutate("r1"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () =>
      calls[0].resolve({ conversation_id: "r1", user_id: "u-1", last_read_at: RECEIPT_AT }),
    );
    await waitFor(() => expect(readCoveredThrough("r1", "u-1")).toBe(RECEIPT_AT));
    expect(client.getQueryState(FOR_YOU)?.isInvalidated).toBe(true);
    // Whoever signs in to this tab next has read nothing yet.
    expect(readCoveredThrough("r1", "u-2")).toBeUndefined();

    act(() => unread.result.current.mutate("r1"));
    await waitFor(() => expect(readCoveredThrough("r1", "u-1")).toBeUndefined());
  });

  it("leaves the queue and the pinned copy alone for a row already read", async () => {
    const pinnedRead = row("r2", T3, { pinned_at: T1 });
    const { client, read } = setup([pinnedRead]);
    const pinnedBefore = client.getQueryData(PINNED_ALL);
    const listBefore = client.getQueryData(ALL);

    act(() => read.result.current.mutate("r2"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () =>
      calls[0].resolve({ conversation_id: "r2", user_id: "u-1", last_read_at: RECEIPT_AT }),
    );
    await waitFor(() => expect(readCoveredThrough("r2", "u-1")).toBe(RECEIPT_AT));
    expect(client.getQueryState(FOR_YOU)?.isInvalidated).toBe(false);
    expect(client.getQueryData(PINNED_ALL)).toBe(pinnedBefore);
    expect(client.getQueryData(ALL)).toBe(listBefore);
  });

  it("refreshes the queue when no cached row says what the read changed", async () => {
    const { client, read } = setup([row("r3", T3)]);

    act(() => read.result.current.mutate("not-cached"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () =>
      calls[0].resolve({ conversation_id: "not-cached", user_id: "u-1", last_read_at: RECEIPT_AT }),
    );
    await waitFor(() => expect(client.getQueryState(FOR_YOU)?.isInvalidated).toBe(true));
  });
});

describe("tags are optimistic when the tag is known", () => {
  const WON: Tag = { id: "t1", name: "Won", color: null };

  it("attaches a cached tag at the click, and a new name only once the server minted it", async () => {
    const client = newClient();
    seedInbox(client);
    client.setQueryData<Page<Tag>>(keys.tags(COMPANY), { data: [WON], next_cursor: null });
    const tagList = keys.conversations.list(COMPANY, { tag_id: "t1" });
    client.setQueryData(tagList, pages([]));
    const { result } = renderHook(() => useAttachTag("c1"), { wrapper: wrapperFor(client) });

    act(() => result.current.mutate({ tag_id: "t1" }));
    await waitFor(() =>
      expect(client.getQueryData<ConversationDetail>(DETAIL)?.tags).toEqual([WON]),
    );
    expect(client.getQueryData<ConversationListData>(OPEN)?.pages[0].data[0].tags).toEqual([WON]);
    expect(ids(client.getQueryData(tagList))).toEqual(["c1"]);
    await act(async () => calls[0].resolve(WON));

    act(() => result.current.mutate({ name: "Callback" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(client.getQueryData<ConversationDetail>(DETAIL)?.tags).toEqual([WON]);
    const minted: Tag = { id: "t2", name: "Callback", color: null };
    await act(async () => calls[1].resolve(minted));
    await waitFor(() =>
      expect(client.getQueryData<ConversationDetail>(DETAIL)?.tags).toEqual([WON, minted]),
    );
  });

  it("detaches at the click and reconciles when the server refuses", async () => {
    const client = newClient();
    seedInbox(client, row("c1", T3, { tags: [WON] }));
    const { result } = renderHook(() => useDetachTag("c1"), { wrapper: wrapperFor(client) });

    act(() => result.current.mutate("t1"));
    await waitFor(() => expect(client.getQueryData<ConversationDetail>(DETAIL)?.tags).toEqual([]));
    expect(client.getQueryData<ConversationListData>(OPEN)?.pages[0].data[0].tags).toEqual([]);

    await act(async () => calls[0].reject(new ApiError("forbidden", "No.", 403)));
    await waitFor(() => expect(client.getQueryState(DETAIL)?.isInvalidated).toBe(true));
  });
});
