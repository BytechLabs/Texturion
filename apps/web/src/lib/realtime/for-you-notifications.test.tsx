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

import { useForYouNotificationsRealtime } from "./for-you-notifications";

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
});
