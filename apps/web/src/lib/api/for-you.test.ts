/**
 * @vitest-environment happy-dom
 *
 * The For you queue is mounted by the shell on every screen, and the nav
 * numerals read its totals. These pin the two things that keeps cheap and
 * honest: a superseded request is aborted rather than left to finish, and
 * completing a task takes it out of the totals as well as the rows.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForYou, ForYouTask } from "./types";

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

import { forYouWithoutTask, useForYou, useSpamReview } from "./for-you";
import { keys } from "./keys";

function task(id: string): ForYouTask {
  return {
    task_id: id,
    title: `Task ${id}`,
    conversation_id: null,
    message_id: null,
    assigned_user_id: null,
    due_at: null,
    overdue: false,
  };
}

const QUEUE: ForYou = {
  waiting_on_you: [],
  my_tasks: [task("mine")],
  unread: [],
  triage: {
    conversations: [],
    tasks: [
      {
        task_id: "open",
        title: "Task open",
        conversation_id: null,
        message_id: null,
        due_at: null,
        overdue: false,
      },
    ],
  },
  totals: {
    waiting_on_you: 4,
    my_tasks: 30,
    unread: 2,
    triage_conversations: 0,
    triage_tasks: 6,
    distinct_work: 40,
  },
};

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

beforeEach(() => {
  fetchSpy.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("forYouWithoutTask", () => {
  it("takes one of my tasks out of the rows, my_tasks and the headline", () => {
    const next = forYouWithoutTask(QUEUE, "mine");
    expect(next?.my_tasks).toEqual([]);
    expect(next?.totals).toMatchObject({ my_tasks: 29, triage_tasks: 6, distinct_work: 39 });
  });

  it("takes an unassigned task out of triage_tasks instead", () => {
    const next = forYouWithoutTask(QUEUE, "open");
    expect(next?.triage?.tasks).toEqual([]);
    expect(next?.totals).toMatchObject({ my_tasks: 30, triage_tasks: 5, distinct_work: 39 });
  });

  it("leaves the totals alone for a task it does not hold", () => {
    expect(forYouWithoutTask(QUEUE, "elsewhere")?.totals).toEqual(QUEUE.totals);
  });
});

describe("useForYou", () => {
  it("aborts a running request when a refetch supersedes it", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal);
      if (signals.length !== 2) return Promise.resolve(json(QUEUE));
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    const { result } = renderHook(() => useForYou(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    void client.refetchQueries({ queryKey: keys.forYou("co-1") });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await act(() => client.invalidateQueries({ queryKey: keys.forYou("co-1") }));

    expect(signals[1]?.aborted).toBe(true);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
  });
});

describe("useSpamReview", () => {
  it("stays fresh for five minutes; the spam mutations invalidate it", async () => {
    fetchSpy.mockResolvedValue(json({ data: [] }));
    renderHook(() => useSpamReview(), { wrapper });
    const query = client.getQueryCache().find({ queryKey: keys.spamReview("co-1") });
    expect((query?.options as { staleTime?: number }).staleTime).toBe(5 * 60_000);
  });
});
