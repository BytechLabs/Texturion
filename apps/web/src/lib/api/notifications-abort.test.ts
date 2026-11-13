/**
 * @vitest-environment happy-dom
 *
 * The bell's unread count and its feed are invalidated on every inbound and
 * assign broadcast. Without the query's AbortSignal reaching fetch, each
 * invalidation of a request still loading left it running beside its
 * replacement; with it, the superseded request is aborted.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { BASE, fetchSpy } = vi.hoisted(() => ({
  BASE: "https://api.loonext.test",
  fetchSpy: vi.fn(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "co-1" }));
vi.mock("./client", async () => {
  const { createApiClient } = await import("./core");
  return {
    apiFetch: createApiClient({
      baseUrl: BASE,
      getAccessToken: async () => "test-token",
      fetch: ((...args: unknown[]) => fetchSpy(...args)) as unknown as typeof fetch,
    }),
  };
});

import { keys } from "./keys";
import { useNotificationsFeed, useNotificationsUnreadCount } from "./notifications";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/** Answers every request but the second, which waits until it is aborted. */
function holdTheSecondRequest(body: unknown): (AbortSignal | null | undefined)[] {
  const signals: (AbortSignal | null | undefined)[] = [];
  fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
    signals.push(init.signal);
    if (signals.length !== 2) return Promise.resolve(json(body));
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  });
  return signals;
}

async function supersede(queryKey: readonly unknown[]) {
  void client.refetchQueries({ queryKey });
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  await act(() => client.invalidateQueries({ queryKey }));
}

beforeEach(() => {
  fetchSpy.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("always-mounted notification queries", () => {
  it("the unread count aborts a request a refetch supersedes", async () => {
    const signals = holdTheSecondRequest({ count: 2 });
    const { result } = renderHook(() => useNotificationsUnreadCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await supersede(keys.notifications.unreadCount("co-1"));

    expect(signals[1]?.aborted).toBe(true);
  });

  it("the feed aborts a request a refetch supersedes", async () => {
    const signals = holdTheSecondRequest({ data: [], next_cursor: null });
    const { result } = renderHook(() => useNotificationsFeed(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await supersede(keys.notifications.feed("co-1"));

    expect(signals[1]?.aborted).toBe(true);
  });
});
