/**
 * @vitest-environment happy-dom
 *
 * The nav numerals read GET /v1/for-you, which the shell already keeps warm.
 * The Tasks numeral used to walk every page of GET /v1/tasks on every screen,
 * twice over, for a number capped at 9+ that /v1/for-you already returns.
 *
 * Real hooks and the real request pipeline; only the network is a spy, so
 * what it records is every request these numerals cost.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForYou, ForYouTask } from "@/lib/api/types";

const { BASE, fetchSpy } = vi.hoisted(() => ({
  BASE: "https://api.loonext.test",
  fetchSpy: vi.fn(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "co-1" }));
vi.mock("@/lib/push/use-unread-count", () => ({
  useUnreadConversationCount: () => 3,
}));
vi.mock("@/lib/api/client", async () => {
  const { createApiClient } = await import("@/lib/api/core");
  return {
    apiFetch: createApiClient({
      baseUrl: BASE,
      getAccessToken: async () => "test-token",
      fetch: ((...args: unknown[]) => fetchSpy(...args)) as unknown as typeof fetch,
    }),
  };
});

import { useCompleteForYouTask } from "@/lib/api/for-you";

import {
  useForYouNavCount,
  useInboxNavCount,
  useTaskNavCount,
} from "./use-nav-counts";

function task(id: string): ForYouTask {
  return {
    task_id: id,
    title: `Task ${id}`,
    conversation_id: null,
    message_id: null,
    assigned_user_id: "user-1",
    due_at: null,
    overdue: false,
  };
}

function forYou(overrides: Partial<ForYou> = {}): ForYou {
  return {
    waiting_on_you: [],
    my_tasks: [task("t1"), task("t2")],
    unread: [],
    triage: null,
    totals: {
      waiting_on_you: 15,
      my_tasks: 37,
      unread: 0,
      triage_conversations: 0,
      triage_tasks: 0,
      distinct_work: 52,
    },
    ...overrides,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestedPaths(): string[] {
  return fetchSpy.mock.calls.map(([url]) => new URL(url as string).pathname);
}

function renderCounts(client: QueryClient) {
  return renderHook(
    () => ({
      forYou: useForYouNavCount(),
      inbox: useInboxNavCount(),
      tasks: useTaskNavCount(),
      complete: useCompleteForYouTask(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    },
  );
}

let client: QueryClient;

beforeEach(() => {
  fetchSpy.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("nav numerals", () => {
  it("count Tasks from the For you totals and never mount a tasks query", async () => {
    fetchSpy.mockResolvedValue(json(forYou()));
    const { result } = renderCounts(client);

    await waitFor(() => expect(result.current.tasks).toBe(37));
    expect(result.current.forYou).toBe(52);
    expect(result.current.inbox).toBe(3);
    // One shared request for both numerals, and nothing under /v1/tasks.
    expect(requestedPaths()).toEqual(["/v1/for-you"]);
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys.some((key) => key.includes("tasks"))).toBe(false);
  });

  it("fall back to the rows from a Worker that predates totals", async () => {
    fetchSpy.mockResolvedValue(json(forYou({ totals: undefined })));
    const { result } = renderCounts(client);

    await waitFor(() => expect(result.current.tasks).toBe(2));
    expect(result.current.forYou).toBe(2);
  });

  it("move at the click when a task is completed, before the server answers", async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      if (init.method === "PATCH") return new Promise<Response>(() => {});
      return Promise.resolve(json(forYou()));
    });
    const { result } = renderCounts(client);
    await waitFor(() => expect(result.current.tasks).toBe(37));

    act(() => {
      result.current.complete.mutate({ task: task("t1"), done: true });
    });

    await waitFor(() => expect(result.current.tasks).toBe(36));
    expect(result.current.forYou).toBe(51);
  });
});
