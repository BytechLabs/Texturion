/** @vitest-environment happy-dom */
/**
 * The For you queue and the bell refetch when a watched query's data changes,
 * and only then.
 *
 * The listener used to react to every 'updated' event: a fetch starting, an
 * invalidation, a refetch that returned the same rows, a patch that changed
 * nothing. One thread open cost four GET /v1/for-you and four GET
 * /v1/notifications/unread-count in production.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let companyId = "company-a";
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => companyId }));

import { patchQuietly, useForYouNotificationsRealtime } from "./for-you-notifications";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(id: string) {
  companyId = id;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKey = [id, "conversations", "list", {}];
  // Two loads, so the list counts as one that already had data.
  client.setQueryData(listKey, { pages: [{ data: [{ id: "c1", unread: true }] }], pageParams: [null] });
  client.setQueryData(listKey, { pages: [{ data: [{ id: "c1", unread: true }] }], pageParams: [null] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useForYouNotificationsRealtime(), { wrapper });
  const forYouRefetches = () =>
    invalidate.mock.calls.filter(([filters]) => {
      const key = (filters as { queryKey?: readonly unknown[] } | undefined)?.queryKey ?? [];
      return key[1] === "for-you";
    }).length;
  return { client, listKey, hook, invalidate, forYouRefetches };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useForYouNotificationsRealtime", () => {
  it("ignores an invalidation and a fetch starting", async () => {
    const { client, listKey, hook, forYouRefetches } = setup("company-invalidate");
    await client.invalidateQueries({ queryKey: listKey, refetchType: "none" });
    await flush();
    expect(forYouRefetches()).toBe(0);
    hook.unmount();
  });

  it("ignores a patch that leaves the data as it was", async () => {
    const { client, listKey, hook, forYouRefetches } = setup("company-same");
    const current = client.getQueryData(listKey);
    client.setQueryData(listKey, current);
    await flush();
    expect(forYouRefetches()).toBe(0);
    hook.unmount();
  });

  it("refetches the queue once when the data really changed", async () => {
    const { client, listKey, hook, forYouRefetches } = setup("company-changed");
    client.setQueryData(listKey, { pages: [{ data: [{ id: "c1", unread: false }] }], pageParams: [null] });
    await flush();
    expect(forYouRefetches()).toBe(1);
    hook.unmount();
  });

  it("ignores queries that cannot move the queue or the bell", async () => {
    const { client, hook, forYouRefetches } = setup("company-other");
    const key = ["company-other", "templates", "list"];
    client.setQueryData(key, [1]);
    client.setQueryData(key, [2]);
    client.setQueryData(key, [3]);
    await flush();
    expect(forYouRefetches()).toBe(0);
    hook.unmount();
  });

  /** Two loads and a change, so the query counts as one that moved. */
  function change(client: QueryClient, key: readonly unknown[]) {
    client.setQueryData(key, [1]);
    client.setQueryData(key, [2]);
    client.setQueryData(key, [3]);
  }

  it("ignores the task and conversation reads neither of them is derived from", async () => {
    // Neither the queue nor the bell counts a task drawer, its links, a thread's timeline or its gallery.
    const id = "company-unwatched";
    const { client, hook, forYouRefetches } = setup(id);
    for (const key of [
      [id, "tasks", "detail", "t1"],
      [id, "tasks", "detail", "t1", "activity"],
      [id, "tasks", "links", "t1"],
      [id, "tasks", "references", "T-142"],
      [id, "conversations", "events", "c1"],
      [id, "conversations", "attachments", "c1"],
    ]) {
      change(client, key);
    }
    await flush();
    expect(forYouRefetches()).toBe(0);
    hook.unmount();
  });

  it("still reacts to task lists, checklists, pinned rows and details", async () => {
    for (const [index, tail] of [
      ["tasks", "list", {}],
      ["tasks", "checklist", "c1"],
      ["conversations", "pinned", {}],
      ["conversations", "detail", "c1"],
    ].entries()) {
      const id = `company-watched-${index}`;
      const { client, hook, forYouRefetches } = setup(id);
      change(client, [id, ...tail]);
      await flush();
      expect(forYouRefetches(), tail.join(" ")).toBe(1);
      hook.unmount();
    }
  });

  it("ignores a write made quietly, and reacts to the next one", async () => {
    // A delivery receipt is a real change to the thread and moves neither
    // the queue nor the bell.
    const { client, listKey, hook, forYouRefetches } = setup("company-quiet");
    patchQuietly(() => {
      client.setQueryData(listKey, { pages: [{ data: [{ id: "c1", unread: false }] }], pageParams: [null] });
    });
    await flush();
    expect(forYouRefetches()).toBe(0);

    client.setQueryData(listKey, { pages: [{ data: [{ id: "c1", unread: true }] }], pageParams: [null] });
    await flush();
    expect(forYouRefetches()).toBe(1);
    hook.unmount();
  });
});
