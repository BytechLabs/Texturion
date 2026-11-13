/**
 * @vitest-environment happy-dom
 *
 * The workspace gate on a hard load: which reads start, and what stays on
 * screen when one of them fails.
 *
 * The API client is the boundary, so it is stubbed per test. Everything between
 * it and the screen is real: the query options, the cache seeding, the cookie
 * read and the branches CompanyProvider renders.
 */
import { INTERNAL_ERROR_CODE } from "@loonext/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useMe } from "@/lib/api/me";
import type { CompanyView, Me } from "@/lib/api/types";
import type { SessionStatus } from "@/lib/auth/use-session-ready";

const { api, session, nav } = vi.hoisted(() => ({
  api: vi.fn<(path: string, options?: { companyId?: string }) => Promise<unknown>>(),
  session: { current: { state: "ready", userId: "user-1" } as SessionStatus },
  nav: { pathname: "/inbox", replace: vi.fn() },
}));

vi.mock("@/lib/api/client", () => ({ apiFetch: api }));
vi.mock("@/lib/auth/use-session-ready", () => ({
  useSession: () => session.current,
  useSessionState: () => session.current.state,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock("@/components/shell/gate-escape", () => ({
  GateSignOut: () => <button type="button">Sign out</button>,
}));

import { CompanyProvider, LANDED_KEY, useActiveCompany } from "./provider";
import { COMPANY_COOKIE } from "./cookie";

/** What the (app) layout passes. */
const SCOPE = "font-golos app-scope font-sans";

const COMPANY = "0b6f3f9e-6c1d-4a4e-9a51-2f0b8f0c1a11";

const company = { id: COMPANY, name: "Rivera Plumbing" } as unknown as CompanyView;

const me: Me = {
  user_id: "user-1",
  display_name: "Ana Rivera",
  memberships: [
    {
      company_id: COMPANY,
      name: "Rivera Plumbing",
      role: "member",
      subscription_status: "active",
    } as Me["memberships"][number],
  ],
};

/** A promise this test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Shell() {
  const { companyId } = useActiveCompany();
  const meRead = useMe();
  return (
    <>
      <p>shell for {companyId}</p>
      {meRead.isRefetchError && <p>shell saw the refetch fail</p>}
    </>
  );
}

/** The app's retry rule (app-providers.tsx), without the waits. */
function appQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !(error instanceof ApiError && !error.retryable) && failureCount < 2,
        retryDelay: 0,
      },
    },
  });
}

function mount(queryClient = appQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <CompanyProvider scopeClassName={SCOPE}>
        <Shell />
      </CompanyProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The calls the API client saw, as `path` or `path@company`. */
function calls(): string[] {
  return api.mock.calls.map(([path, options]) =>
    options?.companyId ? `${path}@${options.companyId}` : path,
  );
}

function setCompanyCookie(value: string | null) {
  document.cookie =
    value === null
      ? `${COMPANY_COOKIE}=; Max-Age=0; Path=/`
      : `${COMPANY_COOKIE}=${value}; Path=/`;
}

beforeEach(() => {
  api.mockReset();
  nav.replace.mockReset();
  nav.pathname = "/inbox";
  session.current = { state: "ready", userId: "user-1" };
  setCompanyCookie(COMPANY);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  setCompanyCookie(null);
});

describe("CompanyProvider boot reads", () => {
  it("starts the hydrated /v1/me beside the plain one when a workspace is remembered", async () => {
    const plain = deferred<Me>();
    const hydrated = deferred<Me>();
    api.mockImplementation((path, options) =>
      options?.companyId ? hydrated.promise : plain.promise,
    );
    mount();

    await waitFor(() =>
      expect(calls()).toEqual(["/v1/me", `/v1/me@${COMPANY}`]),
    );
    // Neither has answered: the two are in flight together.
    expect(screen.getByText("Loading your workspace…")).toBeTruthy();

    await act(async () => {
      plain.resolve(me);
      hydrated.resolve({ ...me, company });
    });
    expect(await screen.findByText(`shell for ${COMPANY}`)).toBeTruthy();
  });

  it("with no workspace remembered, starts the hydrated read once /v1/me names one", async () => {
    setCompanyCookie(null);
    const plain = deferred<Me>();
    api.mockImplementation((_path, options) =>
      options?.companyId ? Promise.resolve({ ...me, company }) : plain.promise,
    );
    mount();
    await waitFor(() => expect(calls()).toEqual(["/v1/me"]));

    await act(async () => plain.resolve(me));
    await waitFor(() =>
      expect(calls()).toEqual(["/v1/me", `/v1/me@${COMPANY}`]),
    );
  });

  it("ignores a refusal of the hydrated read for a stale workspace", async () => {
    api.mockImplementation(async (_path, options) => {
      if (options?.companyId) {
        throw new ApiError("forbidden", "Not an active member of this company.", 403);
      }
      return me;
    });
    mount();
    expect(await screen.findByText(`shell for ${COMPANY}`)).toBeTruthy();
    // Asked once: a refusal is not retried.
    expect(calls().filter((c) => c === `/v1/me@${COMPANY}`)).toHaveLength(1);
    expect(screen.queryByText(/couldn't load your workspace/i)).toBeNull();
  });

  it("leaves the hydrated read's retries alone, so a realtime refetch rides out a blip", async () => {
    // RealtimeProvider shares this query, and a refetch runs with the options
    // of whichever observer rendered last.
    let blips = 0;
    api.mockImplementation(async (_path, options) => {
      if (options?.companyId && blips > 0) {
        blips -= 1;
        throw new ApiError(INTERNAL_ERROR_CODE, "Blip.", 500);
      }
      return options?.companyId ? { ...me, company } : me;
    });
    const queryClient = mount();
    const hydrated = ["me", "company", COMPANY];
    await waitFor(() =>
      expect(queryClient.getQueryState(hydrated)?.status).toBe("success"),
    );

    blips = 1;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    expect(queryClient.getQueryState(hydrated)?.error).toBeNull();
    expect(calls().filter((c) => c === `/v1/me@${COMPANY}`)).toHaveLength(3);
  });

  it("writes the embedded company view to the /v1/company cache", async () => {
    api.mockImplementation(async (_path, options) =>
      options?.companyId ? { ...me, company } : me,
    );
    const queryClient = mount();
    await waitFor(() =>
      expect(queryClient.getQueryData(keys.company(COMPANY))).toEqual(company),
    );
  });

  it("writes nothing when /v1/me leaves the company out (aal1, #581)", async () => {
    api.mockImplementation(async () => me);
    const queryClient = mount();
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["me", "company", COMPANY])?.status,
      ).toBe("success"),
    );
    expect(queryClient.getQueryData(keys.company(COMPANY))).toBeUndefined();
  });

  it("opens the connection to the API origin before the first read", () => {
    api.mockImplementation(() => new Promise(() => {}));
    mount();
    const link = document.head.querySelector(
      'link[rel="preconnect"][href="https://api.test"]',
    );
    // React writes the anonymous mode as an empty attribute; a credentialed
    // connection would not be reused by the API client's fetch.
    expect(link?.getAttribute("crossorigin")).toBe("");
  });
});

describe("CompanyProvider failure states", () => {
  it("keeps the shell when a background refetch of /v1/me fails", async () => {
    let failNext = false;
    api.mockImplementation(async (_path, options) => {
      if (failNext && !options?.companyId) {
        throw new ApiError("forbidden", "Refused.", 403);
      }
      return options?.companyId ? { ...me, company } : me;
    });
    const queryClient = mount();
    expect(await screen.findByText(`shell for ${COMPANY}`)).toBeTruthy();

    failNext = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.me, exact: true });
    });
    // Rendered by the shell itself, so the failure has reached the tree.
    expect(await screen.findByText("shell saw the refetch fail")).toBeTruthy();
    expect(screen.getByText(`shell for ${COMPANY}`)).toBeTruthy();
    expect(screen.queryByText(/couldn't load your workspace/i)).toBeNull();
  });

  it("shows the load-failed card, in the app's face, when the first /v1/me fails", async () => {
    api.mockImplementation(async () => {
      throw new ApiError("forbidden", "Refused.", 403);
    });
    mount();
    const sentence = await screen.findByText(/couldn't load your workspace/i);
    expect(sentence.parentElement?.className).toContain("app-scope");
    expect(sentence.parentElement?.className).toContain("font-golos");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("draws the loading card in the app's face", () => {
    api.mockImplementation(() => new Promise(() => {}));
    mount();
    const sentence = screen.getByText("Loading your workspace…");
    expect(sentence.parentElement?.className).toContain("app-scope");
    expect(sentence.parentElement?.className).toContain("font-golos");
  });

  it("shows the session-expired card once the session is gone, even over a loaded shell", async () => {
    api.mockImplementation(async (_path, options) =>
      options?.companyId ? { ...me, company } : me,
    );
    const queryClient = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <CompanyProvider scopeClassName={SCOPE}>
          <Shell />
        </CompanyProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(`shell for ${COMPANY}`)).toBeTruthy();

    session.current = { state: "signed-out", userId: null };
    rerender(
      <QueryClientProvider client={queryClient}>
        <CompanyProvider scopeClassName={SCOPE}>
          <Shell />
        </CompanyProvider>
      </QueryClientProvider>,
    );
    const sentence = screen.getByText(/your session has expired/i);
    expect(screen.queryByText(`shell for ${COMPANY}`)).toBeNull();
    expect(sentence.closest(".app-scope")).not.toBeNull();
  });
});

describe("a member's launch (D23)", () => {
  const hint = `loonext:landing-role:user-1:${COMPANY}`;

  it("sends only a remembered member's first /inbox to For you, before /v1/me answers", async () => {
    api.mockImplementation(() => new Promise(() => {}));

    localStorage.setItem(hint, "owner");
    mount();
    cleanup();

    localStorage.setItem(hint, "member");
    sessionStorage.setItem(LANDED_KEY, "1");
    mount();
    cleanup();

    sessionStorage.clear();
    nav.pathname = "/inbox/conversation-1";
    mount();
    await act(async () => {});
    cleanup();
    expect(nav.replace).not.toHaveBeenCalled();

    nav.pathname = "/inbox";
    mount();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/for-you"));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});
