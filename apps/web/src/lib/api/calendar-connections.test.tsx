/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("./client", () => ({ apiFetch }));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "company-245",
}));

import {
  useAuthorizeCalendarConnection,
  useCalendarAttention,
  useCalendarConnections,
  useDisconnectCalendarConnection,
  useResolveCalendarAttention,
} from "./calendar";

function harness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

beforeEach(() => apiFetch.mockReset());

describe("#245 calendar connection client contract", () => {
  it("loads the member's company-scoped connections", async () => {
    const response = {
      connections: [],
      configured: { google: true, microsoft: false },
    };
    apiFetch.mockResolvedValueOnce(response);
    const { client, Wrapper } = harness();
    const { result } = renderHook(() => useCalendarConnections(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(apiFetch).toHaveBeenCalledWith("/v1/calendar/connections", {
      companyId: "company-245",
    });
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ["company-245", "calendar-connections"] }),
    ).toBeTruthy();
  });

  it("starts Google authorization without inventing a calendar choice", async () => {
    apiFetch.mockResolvedValueOnce({ url: "https://accounts.google.test/oauth" });
    const { Wrapper } = harness();
    const { result } = renderHook(() => useAuthorizeCalendarConnection(), {
      wrapper: Wrapper,
    });

    await act(() => result.current.mutateAsync({ provider: "google" }));
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/calendar/connections/google/authorize",
      { companyId: "company-245", method: "POST" },
    );
  });

  it("disconnects one connection and invalidates the list", async () => {
    apiFetch.mockResolvedValueOnce(null);
    const { client, Wrapper } = harness();
    client.setQueryData(["company-245", "calendar-connections"], {
      connections: [],
      configured: { google: true, microsoft: true },
    });
    client.setQueryData(["company-245", "calendar-attention"], {
      attention: [{ id: "link-1" }],
    });
    const { result } = renderHook(() => useDisconnectCalendarConnection(), {
      wrapper: Wrapper,
    });

    await act(() => result.current.mutateAsync("connection-7"));
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/calendar/connections/connection-7",
      { companyId: "company-245", method: "DELETE" },
    );
    expect(
      client.getQueryState(["company-245", "calendar-connections"])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["company-245", "calendar-attention"])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("loads only the signed-in member's schedule decisions", async () => {
    const response = { attention: [] };
    apiFetch.mockResolvedValueOnce(response);
    const { client, Wrapper } = harness();
    const { result } = renderHook(() => useCalendarAttention(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(apiFetch).toHaveBeenCalledWith("/v1/calendar/attention", {
      companyId: "company-245",
    });
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ["company-245", "calendar-attention"] }),
    ).toBeTruthy();
  });

  it("resolves one decision and invalidates every affected product view", async () => {
    apiFetch.mockResolvedValueOnce({ outcome: "queued" });
    const { client, Wrapper } = harness();
    client.setQueryData(["company-245", "calendar-attention"], {
      attention: [],
    });
    client.setQueryData(["company-245", "calendar-connections"], {
      connections: [],
      configured: { google: true, microsoft: true },
    });
    client.setQueryData(
      ["company-245", "tasks", "list", { status: "open" }],
      { pages: [] },
    );
    client.setQueryData(
      ["company-245", "tasks", "detail", "task-1"],
      { id: "task-1" },
    );
    client.setQueryData(["company-245", "for-you"], { tasks: [] });
    client.setQueryData(
      ["company-245", "messages", "conversation-1"],
      { data: [] },
    );
    const { result } = renderHook(() => useResolveCalendarAttention(), {
      wrapper: Wrapper,
    });

    await act(() =>
      result.current.mutateAsync({
        id: "link-7",
        resolution: { action: "use_app" },
      }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/calendar/attention/link-7/resolve",
      {
        companyId: "company-245",
        method: "POST",
        body: { action: "use_app" },
      },
    );
    expect(
      client.getQueryState(["company-245", "calendar-attention"])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["company-245", "calendar-connections"])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState([
        "company-245",
        "tasks",
        "list",
        { status: "open" },
      ])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["company-245", "tasks", "detail", "task-1"])
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["company-245", "for-you"])?.isInvalidated)
      .toBe(true);
    expect(
      client.getQueryState(["company-245", "messages", "conversation-1"])
        ?.isInvalidated,
    ).toBe(true);
  });
});
