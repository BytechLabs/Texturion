/**
 * @vitest-environment happy-dom
 *
 * useCompany on boot: the company view comes from the hydrated /v1/me the
 * shell already asked for, and GET /v1/company is asked only when /me left it
 * out or the cache is being refreshed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MfaGate } from "@/components/shell/mfa-gate";

import { useCompany } from "./companies";
import { ApiError } from "./error";
import { keys } from "./keys";
import { meCompanyQueryOptions } from "./me-company";
import type { CompanyView, Me } from "./types";

const { api } = vi.hoisted(() => ({
  api: vi.fn<(path: string, options?: { companyId?: string }) => Promise<unknown>>(),
}));

const COMPANY = "0b6f3f9e-6c1d-4a4e-9a51-2f0b8f0c1a11";

vi.mock("./client", () => ({ apiFetch: api }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => COMPANY }));
vi.mock("@/components/auth/mfa-challenge", () => ({
  MfaChallenge: () => <p>enter your code</p>,
}));
vi.mock("@/components/shell/gate-escape", () => ({
  GateSignOut: () => <button type="button">Sign out</button>,
}));

const fromMe = { id: COMPANY, name: "From /me" } as unknown as CompanyView;
const fromCompany = { id: COMPANY, name: "From /company" } as unknown as CompanyView;
const me: Me = { user_id: "user-1", display_name: "Ana", memberships: [] };

/** The app turns retries off for non-retryable refusals; so does this. */
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The calls the API client saw, as `path` or `path@company`. */
function calls(): string[] {
  return api.mock.calls.map(([path, options]) =>
    options?.companyId ? `${path}@${options.companyId}` : path,
  );
}

beforeEach(() => {
  api.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useCompany", () => {
  it("joins the hydrated /v1/me in flight instead of asking /v1/company", async () => {
    let answer!: (value: Me) => void;
    api.mockImplementation((path) =>
      path === "/v1/me"
        ? new Promise<Me>((resolve) => (answer = resolve))
        : Promise.resolve(fromCompany),
    );
    const queryClient = newClient();
    // What CompanyProvider starts at boot, before the shell mounts.
    void queryClient.prefetchQuery(meCompanyQueryOptions(queryClient, COMPANY));

    const { result } = renderHook(() => useCompany(), {
      wrapper: wrapperFor(queryClient),
    });
    await act(async () => answer({ ...me, company: fromMe }));

    await waitFor(() => expect(result.current.data).toEqual(fromMe));
    expect(calls()).toEqual([`/v1/me@${COMPANY}`]);
  });

  it("asks /v1/company itself on a refetch, so a settings save reads the server", async () => {
    api.mockImplementation(async (path) =>
      path === "/v1/me" ? { ...me, company: fromMe } : fromCompany,
    );
    const queryClient = newClient();
    const { result } = renderHook(() => useCompany(), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.data).toEqual(fromMe));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.company(COMPANY) });
    });
    await waitFor(() => expect(result.current.data).toEqual(fromCompany));
    expect(calls()).toEqual([`/v1/me@${COMPANY}`, `/v1/company@${COMPANY}`]);
  });

  it("asks /v1/company when /v1/me left the view out, so MfaGate still sees its code (#581)", async () => {
    api.mockImplementation(async (path) => {
      if (path === "/v1/me") return me;
      throw new ApiError(
        "mfa_challenge_required",
        "Enter your code to continue.",
        403,
      );
    });
    const queryClient = newClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MfaGate>
          <p>the shell</p>
        </MfaGate>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("enter your code")).toBeTruthy();
    expect(screen.queryByText("the shell")).toBeNull();
    expect(calls()).toEqual([`/v1/me@${COMPANY}`, `/v1/company@${COMPANY}`]);
  });
});
