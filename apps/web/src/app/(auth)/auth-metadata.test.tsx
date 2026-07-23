import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The (auth) group layout pulls in the app shell providers (TanStack Query,
// the wordmark), and the invite segment layout mounts the shared gate escape
// cluster. We only assert static `metadata` and layout shape, so stub those
// imports to keep this a node-only unit test.
vi.mock("@/components/shell/wordmark", () => ({ Wordmark: () => null }));
vi.mock("@/components/shell/gate-header", () => ({
  GateEscape: () => <div data-testid="gate-escape" />,
}));
vi.mock("../app-providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

import { metadata as authMetadata } from "./layout";
import InviteTitleLayout, {
  metadata as inviteMetadata,
} from "./invite/[token]/layout";
import LoginTitleLayout, { metadata as loginMetadata } from "./login/layout";
import ResetTitleLayout, {
  metadata as resetMetadata,
} from "./reset-password/layout";
import SignupTitleLayout, {
  metadata as signupMetadata,
} from "./signup/layout";
import UpdateTitleLayout, {
  metadata as updateMetadata,
} from "./update-password/layout";

describe("(auth) group metadata", () => {
  it("takes the whole auth surface out of search indexes", () => {
    // Transactional pages: noindex is the industry-standard posture, and the
    // per-route step layouts inherit it (no robots override on them).
    expect(authMetadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("per-route auth tab titles (wrapped by the root '%s · Loonext')", () => {
  it("names each auth screen and never restates robots (inherited)", () => {
    expect(loginMetadata.title).toBe("Log in");
    expect(signupMetadata.title).toBe("Create your account");
    expect(resetMetadata.title).toBe("Reset your password");
    expect(updateMetadata.title).toBe("Set a new password");
    expect(inviteMetadata.title).toBe("Accept your invitation");
    for (const m of [
      loginMetadata,
      signupMetadata,
      resetMetadata,
      updateMetadata,
      inviteMetadata,
    ]) {
      expect(m.robots).toBeUndefined();
    }
  });

  it("renders children untouched (metadata-only segment layouts)", () => {
    const child = "step" as unknown as React.ReactNode;
    expect(LoginTitleLayout({ children: child })).toBe(child);
    expect(SignupTitleLayout({ children: child })).toBe(child);
    expect(ResetTitleLayout({ children: child })).toBe(child);
    expect(UpdateTitleLayout({ children: child })).toBe(child);
  });

  it("invite layout renders children plus the shared gate escape (#207)", () => {
    const markup = renderToStaticMarkup(
      <InviteTitleLayout>
        <div data-testid="invite-child" />
      </InviteTitleLayout>,
    );
    expect(markup).toContain('data-testid="invite-child"');
    expect(markup).toContain('data-testid="gate-escape"');
  });
});
