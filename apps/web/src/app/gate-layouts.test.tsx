import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #207 LAW: every full-screen authenticated gate must mount the SHARED gate
 * escape (workspace switcher + sign out) from
 * `@/components/shell/gate-header` — never a bespoke copy. A gate without it
 * traps a multi-workspace member (switching into a non-onboarded workspace
 * used to strand the user on its onboarding gate with no way back).
 *
 * Two levels:
 *   1. Source law — each gate layout imports the shared module and mounts
 *      GateHeader/GateEscape (grep over the source, so a refactor that drops
 *      the affordance fails loudly).
 *   2. Render — the onboarding layout (the layout EVERY wizard/checkout/
 *      setting-up gate shares) actually renders the switcher and sign out.
 *
 * Adding a new gate surface (a suspended/billing-lock screen, a new wizard)?
 * Put it on an existing gate layout, or add its layout to GATE_LAYOUTS here
 * and mount the shared header — do not hand-roll chrome.
 */

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * Every layout that renders a full-screen authenticated state OUTSIDE the
 * (app) shell. The (app) shell itself carries the sidebar switcher + member
 * menu; (auth) login/signup/reset are signed-out surfaces; (marketing) is
 * public. Everything else that can hold a signed-in user belongs in this list.
 */
const GATE_LAYOUTS: { file: string; mounts: string }[] = [
  // The onboarding wizard: name/number/business/texting/plan (checkout),
  // the port sub-wizard, and setting-up ALL share this one layout — fixing
  // it once fixes the whole class of wizard gates.
  { file: "onboarding/layout.tsx", mounts: "<GateHeader" },
  // Invite accept renders inside the (auth) card; its segment layout mounts
  // the escape cluster (renders nothing while signed out).
  { file: "(auth)/invite/[token]/layout.tsx", mounts: "<GateEscape" },
];

describe("gate layouts mount the shared escape hatch (#207)", () => {
  it.each(GATE_LAYOUTS)(
    "$file imports and mounts the shared gate header",
    ({ file, mounts }) => {
      const source = readFileSync(path.join(APP_DIR, file), "utf8");
      expect(source).toContain('from "@/components/shell/gate-header"');
      expect(source).toContain(mounts);
    },
  );

  it("no gate layout hand-rolls its own sign-out control", () => {
    for (const { file } of GATE_LAYOUTS) {
      const source = readFileSync(path.join(APP_DIR, file), "utf8");
      // The retired bespoke control (app/onboarding/sign-out.tsx) and any
      // successor must not come back — sign out lives in the shared header.
      expect(source).not.toMatch(/from ["'].*sign-out["']/);
    }
  });

  it("the CompanyProvider /me-error state mounts the shared sign-out", () => {
    // Not a layout, but the same law: when /me fails, memberships are
    // unknowable (no switcher possible) yet sign-out must stay reachable —
    // the last retry-only dead end found by the #207 audit.
    const source = readFileSync(
      path.join(APP_DIR, "../lib/company/provider.tsx"),
      "utf8",
    );
    // gate-escape, not gate-header: the escape cluster is split from the
    // header so this font-free surface skips the Wordmark's next/font import.
    expect(source).toContain('from "@/components/shell/gate-escape"');
    expect(source).toContain("<GateSignOut");
  });
});

// ---------------------------------------------------------------------------
// Render level: the onboarding layout (shared by every wizard/checkout gate)
// really renders the switcher + sign out for a multi-workspace member.
// ---------------------------------------------------------------------------

vi.mock("./app-providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));
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
  useSessionReady: () => true,
}));
vi.mock("@/lib/api/me", () => ({
  useMe: () => ({
    data: {
      memberships: [
        { company_id: "co-a", name: "Rivera Plumbing" },
        { company_id: "co-b", name: "Beta Crew" },
      ],
    },
  }),
}));
// The wordmark mounts a next/font face — irrelevant here, stub it.
vi.mock("@/components/shell/wordmark", () => ({
  Wordmark: () => <span data-testid="wordmark" />,
}));

import OnboardingLayout from "./onboarding/layout";

describe("onboarding gate renders the escape hatch (#207)", () => {
  it("a multi-workspace member sees the workspace switcher and sign out on every wizard step", () => {
    const markup = renderToStaticMarkup(
      <OnboardingLayout>
        <div data-testid="wizard-step" />
      </OnboardingLayout>,
    );
    expect(markup).toContain('aria-label="Switch workspace"');
    // Cookie unset in this environment → same first-membership fallback as
    // CompanyProvider, so the trigger names the active workspace.
    expect(markup).toContain("Rivera Plumbing");
    expect(markup).toContain("Sign out");
    expect(markup).toContain('data-testid="wizard-step"');
  });
});
