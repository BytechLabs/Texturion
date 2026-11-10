/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "./types";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

let search = "message=m-old";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "co-1" }));
const apiFetch = vi.fn();
vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const {
  messagesSearchParams,
  nextMessagesParam,
  previousMessagesParam,
  threadCacheMatches,
  useMessages,
} = await import("./messages");
const { threadUpsertMessages } = await import("./cache");

function msg(id: string, at: string): Message {
  return {
    id,
    conversation_id: "conv-1",
    direction: "inbound",
    body: id,
    status: "received",
    created_at: at,
  } as unknown as Message;
}

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

beforeEach(() => {
  search = "message=m-old";
  apiFetch.mockReset();
});
afterEach(cleanup);

describe("#718 the thread opened at a message", () => {
  it("builds the URL params for each kind of page", () => {
    expect(messagesSearchParams(undefined)).toEqual({
      cursor: undefined,
      direction: undefined,
      around: undefined,
      limit: undefined,
    });
    expect(messagesSearchParams({ around: "m1" }).around).toBe("m1");
    expect(
      messagesSearchParams({ cursor: "c", direction: "newer" }),
    ).toMatchObject({ cursor: "c", direction: "newer" });
  });

  it("pages older from next_cursor and newer from newer_cursor", () => {
    expect(nextMessagesParam({ data: [], next_cursor: "n" })).toEqual({
      cursor: "n",
    });
    expect(nextMessagesParam({ data: [], next_cursor: null })).toBeUndefined();
    expect(
      previousMessagesParam({ data: [], next_cursor: null, newer_cursor: "x" }),
    ).toEqual({ cursor: "x", direction: "newer" });
    expect(
      previousMessagesParam({ data: [], next_cursor: null, newer_cursor: null }),
    ).toBeUndefined();
  });

  it("fetches a message older than the first page with around only", async () => {
    apiFetch.mockResolvedValueOnce({
      data: [msg("m-old", "2025-01-01T10:00:00.000Z")],
      next_cursor: "older",
      newer_cursor: "newer",
      anchor_id: "m-old",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useMessages("conv-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe("/v1/conversations/conv-1/messages");
    expect(apiFetch.mock.calls[0][1].searchParams).toEqual({
      cursor: undefined,
      direction: undefined,
      around: "m-old",
      limit: undefined,
    });
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.hasPreviousPage).toBe(true);

    apiFetch.mockResolvedValueOnce({
      data: [msg("m-new", "2025-01-02T10:00:00.000Z")],
      next_cursor: null,
      newer_cursor: null,
    });
    await result.current.fetchPreviousPage();
    expect(apiFetch.mock.calls[1][1].searchParams).toMatchObject({
      cursor: "newer",
      direction: "newer",
      around: undefined,
    });
    await waitFor(() => expect(result.current.hasPreviousPage).toBe(false));
    // The newer page sits first (the list is newest-first), the window after it.
    expect(result.current.data?.pages.map((p) => p.data[0].id)).toEqual([
      "m-new",
      "m-old",
    ]);
  });

  it("opens the plain newest page when the URL names no message", async () => {
    search = "";
    apiFetch.mockResolvedValueOnce({
      data: [],
      next_cursor: null,
      newer_cursor: null,
    });
    const client = new QueryClient();
    renderHook(() => useMessages("conv-1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0][1].searchParams.around).toBeUndefined();
  });

  it("a cached window is not the plain thread, and the reverse", () => {
    const window = {
      pages: [{ data: [], next_cursor: null, newer_cursor: "x" }],
      pageParams: [{ around: "m1" }],
    };
    expect(threadCacheMatches(window, "m1")).toBe(true);
    expect(threadCacheMatches(window, "m2")).toBe(false);
    expect(threadCacheMatches(window, null)).toBe(false);
    const plain = {
      pages: [{ data: [], next_cursor: null }],
      pageParams: [undefined],
    };
    expect(threadCacheMatches(plain, null)).toBe(true);
    expect(threadCacheMatches(plain, "m1")).toBe(false);
    expect(threadCacheMatches(undefined, "m1")).toBe(true);
  });

  it("a live message waits for the window to reach the newest", () => {
    const windowed = {
      pages: [
        {
          data: [msg("m1", "2025-01-01T10:00:00.000Z")],
          next_cursor: null,
          newer_cursor: "x",
        },
      ],
      pageParams: [{ around: "m1" }],
    };
    const live = msg("m-live", "2026-01-01T10:00:00.000Z");
    expect(threadUpsertMessages(windowed, [live]).pages[0].data).toHaveLength(1);
    const atNewest = {
      ...windowed,
      pages: [{ ...windowed.pages[0], newer_cursor: null }],
    };
    expect(threadUpsertMessages(atNewest, [live]).pages[0].data[0].id).toBe(
      "m-live",
    );
  });
});
