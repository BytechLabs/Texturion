/**
 * @vitest-environment happy-dom
 *
 * #277 — the wire the cancellation reason travels on.
 *
 * This one is here because of how the feature fails. `useRecordCancellationReason`
 * is fired and never awaited, and its rejection is deliberately swallowed so a
 * dead endpoint cannot stand between somebody and the way out. That is the right
 * behaviour and it costs us the only signal a wrong path would ever produce: if
 * the route were renamed, or the method or the body shape changed, nothing would
 * throw, nothing would be shown, every screen test would stay green, and the
 * reports would simply be empty forever.
 *
 * The card's own tests mock `@/lib/api/billing` wholesale, so they never run
 * this hook at all. These do: the real hook, the real request pipeline, and a
 * fetch that only records what was sent.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { BASE, fetchSpy } = vi.hoisted(() => ({
  BASE: "https://api.loonext.test",
  fetchSpy: vi.fn(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));

// Everything except the network is the real thing: `createApiClient` is the
// same factory `client.ts` wires to the live base URL and Supabase session, so
// what the spy receives is what the browser would have sent.
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

import { useRecordCancellationReason } from "./billing";

function renderRecorder() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(() => useRecordCancellationReason(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** What the spy was handed, once it has been handed something. */
async function sent(): Promise<{ url: URL; init: RequestInit }> {
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), init };
}

afterEach(cleanup);

beforeEach(() => {
  fetchSpy.mockReset();
  // 204 No Content is what the route answers. Nothing reads the result.
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
});

describe("useRecordCancellationReason (POST /v1/billing/cancellation-reason)", () => {
  it("WIRE-1: the method, the path and the body are the ones the route accepts", async () => {
    const { result } = renderRecorder();
    act(() => {
      result.current.mutate({
        reason: "too_expensive",
        detail: "Pro is more than we use.",
      });
    });

    const { url, init } = await sent();
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/v1/billing/cancellation-reason");
    expect(url.search).toBe("");
    expect(JSON.parse(String(init.body))).toEqual({
      reason: "too_expensive",
      detail: "Pro is more than we use.",
    });

    // The record is per workspace, so a missing company header would file
    // every answer against nothing.
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Company-Id"]).toBe("company-1");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("WIRE-2: a skip is sent as both keys null, not as an absent field", async () => {
    // "They were asked and said nothing" is a different number from "we never
    // asked", and only an explicit null carries the difference.
    const { result } = renderRecorder();
    act(() => {
      result.current.mutate({ reason: null, detail: null });
    });

    const { init } = await sent();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["detail", "reason"]);
    expect(body).toEqual({ reason: null, detail: null });
  });

  it("WIRE-3: the 204 the route answers is a success, not a parse failure", async () => {
    const { result } = renderRecorder();
    act(() => {
      result.current.mutate({ reason: "seasonal", detail: null });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
