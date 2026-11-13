/**
 * @vitest-environment happy-dom
 *
 * Opening a call borrows the row the log already holds, a filter's first
 * paint borrows the All list narrowed the server's way, superseded reads are
 * cancelled, and a voicemail's signed URL survives a call broadcast.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Call, Page } from "./types";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, options?: { signal?: AbortSignal }) => Promise<unknown>>(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("./client", () => ({
  apiFetch: (path: string, options?: { signal?: AbortSignal }) => apiFetch(path, options),
}));

import { useCall, useCalls, useVoicemailUrl } from "./calls";
import { keys } from "./keys";

const C = "c-1";

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-1",
    call_session_id: "sess-1",
    direction: "inbound",
    caller_e164: "+16135551000",
    contact_id: "ct-1",
    contact_name: "Dana Roofer",
    caller_name: null,
    phone_number_id: "pn-1",
    conversation_id: "conv-1",
    outcome: "missed",
    forward_seconds: 0,
    screening_result: null,
    stir_attestation: null,
    voicemail_seconds: null,
    voicemail_transcript: null,
    voicemail_intake: null,
    answered_by_user_id: null,
    answered_by_name: null,
    started_at: "2026-11-13T15:00:00Z",
    ...overrides,
  };
}

function pages(rows: Call[], nextCursor: string | null = null) {
  return {
    pages: [{ data: rows, next_cursor: nextCursor } satisfies Page<Call>],
    pageParams: [undefined],
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
}

function mount<T>(client: QueryClient, hook: () => T) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** A read that never answers, so the placeholder is what the hook shows. */
const pending = () => new Promise<never>(() => {});

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(pending);
});
afterEach(() => vi.useRealTimers());

describe("useCall paints from the log", () => {
  it("CA-1: shows the clicked row while the detail loads", () => {
    const client = makeClient();
    client.setQueryData(
      keys.calls(C, "all"),
      pages([call({ outcome: "voicemail", voicemail_seconds: 12, voicemail_transcript: "Hi" })]),
    );
    const { result } = mount(client, () => useCall("sess-1"));
    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toMatchObject({
      contact_name: "Dana Roofer",
      voicemail_transcript: "Hi",
      ended_at: null,
      has_voicemail: true,
      voicemail_transcript_attempted_at: null,
    });
  });

  it("CA-2: finds the row in a contact's call history too, and ignores non-list keys", () => {
    const client = makeClient();
    client.setQueryData([C, "calls", "live", "sess-9"], { conversation_id: null });
    client.setQueryData(keys.calls(C, "all", "any", "ct-1"), pages([call({ voicemail_seconds: null })]));
    const { result } = mount(client, () => useCall("sess-1"));
    expect(result.current.data?.has_voicemail).toBe(false);
  });

  it("CA-3: waits on a skeleton for a call no list holds", () => {
    const client = makeClient();
    client.setQueryData(keys.calls(C, "all"), pages([call({ call_session_id: "other" })]));
    const { result } = mount(client, () => useCall("sess-1"));
    expect(result.current.isPending).toBe(true);
  });
});

describe("a filtered log's first paint", () => {
  it("CA-4: is the cached All rows with that outcome, and offers no Load more yet", () => {
    const client = makeClient();
    client.setQueryData(
      keys.calls(C, "all"),
      pages(
        [
          call({ id: "a", outcome: "answered" }),
          call({ id: "m", outcome: "missed" }),
          call({ id: "live", outcome: null }),
        ],
        "cursor-2",
      ),
    );
    const { result } = mount(client, () => useCalls("missed"));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.pages.flatMap((page) => page.data).map((row) => row.id)).toEqual(["m"]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("CA-5: is a skeleton when the loaded All pages hold no match but older pages might", () => {
    const client = makeClient();
    client.setQueryData(keys.calls(C, "all"), pages([call({ outcome: "answered" })], "cursor-2"));
    const { result } = mount(client, () => useCalls("missed"));
    expect(result.current.isPending).toBe(true);
  });

  it("CA-6: says empty only when the All list is complete", () => {
    const client = makeClient();
    client.setQueryData(keys.calls(C, "all"), pages([call({ outcome: "answered" })], null));
    const { result } = mount(client, () => useCalls("voicemail"));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.pages[0].data).toEqual([]);
  });

  it("CA-7: All itself has no placeholder", () => {
    const client = makeClient();
    const { result } = mount(client, () => useCalls());
    expect(result.current.isPending).toBe(true);
  });
});

describe("reads take the query's signal", () => {
  it("CA-8: the log and the detail pass an AbortSignal", async () => {
    const client = makeClient();
    mount(client, () => useCalls());
    mount(client, () => useCall("sess-1"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    for (const [, options] of apiFetch.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("the voicemail URL", () => {
  it("CA-9: is not refetched by a call broadcast or the company resync", async () => {
    apiFetch.mockResolvedValue({ url: "https://signed/one", seconds: 12, transcript: null });
    const client = makeClient();
    const { result } = mount(client, () => useVoicemailUrl("sess-1", true));
    await waitFor(() => expect(result.current.data?.url).toBe("https://signed/one"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: [C, "calls"], refetchType: "active" });
      await client.invalidateQueries({ queryKey: [C], refetchType: "active" });
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("CA-10: keeps the company in its key and is kept as long as it is trusted", async () => {
    apiFetch.mockResolvedValue({ url: "https://signed/one", seconds: 12, transcript: null });
    const client = makeClient();
    const { result } = mount(client, () => useVoicemailUrl("sess-1", true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: ["voicemail-url", C, "sess-1"] });
    expect(query).toBeDefined();
    expect(query?.options.gcTime).toBe(50 * 60_000);
  });
});
