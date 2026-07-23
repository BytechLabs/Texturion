import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #207: gates (onboarding wizard, checkout step, setting-up, invite accept)
 * render outside the (app) shell, so the shared gate header is the ONLY
 * workspace-switch + sign-out affordance there. These tests pin that contract
 * at render level, and pin that switching persists through the SAME cookie the
 * in-app switcher (CompanyProvider) uses — never a second mechanism.
 */

interface FakeMembership {
  company_id: string;
  name: string;
}

const state: {
  sessionReady: boolean;
  me: { memberships: FakeMembership[] } | undefined;
  cookie: string | null;
} = { sessionReady: true, me: undefined, cookie: null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({ auth: { signOut: vi.fn() } }),
}));
vi.mock("@/lib/auth/use-session-ready", () => ({
  useSessionReady: () => state.sessionReady,
}));
vi.mock("@/lib/api/me", () => ({
  useMe: () => ({ data: state.me }),
}));
// The wordmark mounts a next/font face — irrelevant here, stub it.
vi.mock("./wordmark", () => ({
  Wordmark: () => <span data-testid="wordmark" />,
}));
// Keep the REAL resolveActiveCompanyId (the same resolution CompanyProvider
// and the onboarding wizard use); control only the cookie I/O.
vi.mock("@/lib/company/cookie", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/company/cookie")>();
  return {
    ...actual,
    readCompanyCookie: () => state.cookie,
    writeCompanyCookie: vi.fn(),
  };
});

import { writeCompanyCookie } from "@/lib/company/cookie";

import {
  GateEscape,
  GateHeader,
  switchWorkspaceFromGate,
} from "./gate-header";

const TWO_WORKSPACES: FakeMembership[] = [
  { company_id: "co-a", name: "Rivera Plumbing" },
  { company_id: "co-b", name: "Beta Crew" },
];

beforeEach(() => {
  state.sessionReady = true;
  state.me = { memberships: TWO_WORKSPACES };
  state.cookie = null;
  vi.mocked(writeCompanyCookie).mockClear();
});

describe("GateEscape", () => {
  it("offers the workspace switcher and sign out to a multi-workspace member", () => {
    state.cookie = "co-b";
    const markup = renderToStaticMarkup(<GateEscape />);
    expect(markup).toContain('aria-label="Switch workspace"');
    // The trigger names the CURRENT workspace (cookie-resolved), so the user
    // can see which workspace's gate they are stuck in.
    expect(markup).toContain("Beta Crew");
    expect(markup).toContain("Sign out");
  });

  it("falls back to the first membership when no cookie is set (same resolution as CompanyProvider)", () => {
    state.cookie = null;
    const markup = renderToStaticMarkup(<GateEscape />);
    expect(markup).toContain("Rivera Plumbing");
  });

  it("shows a plain workspace label (no menu) for a single-workspace member", () => {
    state.me = { memberships: [TWO_WORKSPACES[0]] };
    const markup = renderToStaticMarkup(<GateEscape />);
    expect(markup).not.toContain("Switch workspace");
    expect(markup).toContain("Rivera Plumbing");
    expect(markup).toContain("Sign out");
  });

  it("still offers sign out while /me is loading (never a dead end)", () => {
    state.me = undefined;
    const markup = renderToStaticMarkup(<GateEscape />);
    expect(markup).not.toContain("Switch workspace");
    expect(markup).toContain("Sign out");
  });

  it("renders nothing without a session (the invite layout serves signed-out visitors too)", () => {
    state.sessionReady = false;
    expect(renderToStaticMarkup(<GateEscape />)).toBe("");
  });
});

describe("switchWorkspaceFromGate", () => {
  it("persists via the in-app switcher's cookie writer and lets CompanyProvider route the landing", () => {
    const push = vi.fn();
    switchWorkspaceFromGate("co-b", "co-a", { push });
    expect(writeCompanyCookie).toHaveBeenCalledWith("co-b");
    // /for-you puts CompanyProvider in charge: it sends a non-onboarded
    // target back to its own gate and an onboarded one into the app.
    expect(push).toHaveBeenCalledWith("/for-you");
  });

  it("re-selecting the active workspace stays put (no redirect bounce)", () => {
    const push = vi.fn();
    switchWorkspaceFromGate("co-a", "co-a", { push });
    expect(writeCompanyCookie).toHaveBeenCalledWith("co-a");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("GateHeader", () => {
  it("is one hairline bar: wordmark plus the escape cluster, no nav", () => {
    state.cookie = "co-a";
    const markup = renderToStaticMarkup(<GateHeader />);
    expect(markup).toContain("<header");
    expect(markup).toContain('data-testid="wordmark"');
    expect(markup).toContain('aria-label="Switch workspace"');
    expect(markup).toContain("Sign out");
    expect(markup).not.toContain("<nav");
  });
});
