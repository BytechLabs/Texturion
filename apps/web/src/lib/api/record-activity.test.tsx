/**
 * @vitest-environment happy-dom
 *
 * A record page starts its timeline's read beside the record's own. The
 * timeline mounting a moment later must reuse that read, while a timeline
 * opened on an older cached history still reads it again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("./client", () => ({ apiFetch: (path: string) => apiFetch(path) }));

import { useRecordActivity } from "./record-activity";

const KEY = ["c-1", "record-activity", "contact", "ct-1", null];
const page = { pages: [{ data: [], next_cursor: null }], pageParams: [undefined] };

async function readsOnMount(ageMs: number): Promise<number> {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  client.setQueryData(KEY, page, { updatedAt: Date.now() - ageMs });
  renderHook(() => useRecordActivity("contact", "ct-1", null), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return apiFetch.mock.calls.length;
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ data: [], next_cursor: null });
});

describe("useRecordActivity on mount", () => {
  it("RA-1: reuses the read the page finished a moment ago", async () => {
    expect(await readsOnMount(1_000)).toBe(0);
  });

  it("RA-2: reads a cached history again on a later open, even inside the stale time", async () => {
    expect(await readsOnMount(20_000)).toBe(1);
  });
});
