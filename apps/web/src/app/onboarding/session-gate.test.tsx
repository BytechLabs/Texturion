/**
 * #257 — an expired session must not present as "still loading".
 *
 * The middleware deliberately fails open on an auth blip (a session cookie
 * plus a getUser() error suppresses the /login redirect), so a dead session
 * reaches the wizard rather than being bounced. Every step gates /v1/me on the
 * session, and a disabled TanStack query stays `isPending` forever — so the
 * wizard's status never left "loading" and the screen sat on "Picking up where
 * you left off…" with no sign-out and no way back to login. The app shell
 * already handled this; onboarding never did.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ current: "ready" as string }));

vi.mock("@/lib/auth/use-session-ready", () => ({
  useSessionState: () => sessionState.current,
  useSessionReady: () => sessionState.current === "ready",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/shell/gate-escape", () => ({
  GateSignOut: () => <button type="button">Sign out</button>,
}));

import { OnboardingSessionGate } from "./session-gate";

const SKELETON = "Picking up where you left off…";

function markup(): string {
  return renderToStaticMarkup(
    <OnboardingSessionGate>
      <p>{SKELETON}</p>
    </OnboardingSessionGate>,
  );
}

describe("OnboardingSessionGate", () => {
  it("renders the wizard while the session is resolving or live", () => {
    for (const state of ["pending", "ready"]) {
      sessionState.current = state;
      expect(markup()).toContain(SKELETON);
    }
  });

  it("says the session expired and offers both ways out", () => {
    sessionState.current = "signed-out";
    const html = markup();

    // The skeleton is gone — it would have stayed there forever.
    expect(html).not.toContain(SKELETON);
    expect(html).toContain("Your session has expired.");
    // Both exits: back to login, and sign out (GateEscape hides itself
    // without a session, so this is the only one the header can offer).
    expect(html).toContain("Go to sign in");
    expect(html).toContain("Sign out");
  });
});
