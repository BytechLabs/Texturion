import { describe, expect, it, vi } from "vitest";

// The (app) group layout pulls in the shell, the realtime/company providers,
// and the Golos next/font module (which cannot load in a node test). We only
// assert its static `metadata`, so stub every heavy import; the default
// component is never rendered here.
vi.mock("@/components/for-you/landing-gate", () => ({ LandingGate: () => null }));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/app/fonts", () => ({ golosText: { variable: "font-golos" } }));
vi.mock("@/lib/company/provider", () => ({
  CompanyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/realtime/provider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../app-providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

import { metadata as appMetadata } from "./layout";
import ContactsTitleLayout, {
  metadata as contactsMetadata,
} from "./contacts/layout";

describe("(app) group metadata", () => {
  it("pins the signed-in title template + a plain default, and stays crawlable-config", () => {
    expect(appMetadata.title).toEqual({
      default: "Loonext",
      template: "%s · Loonext",
    });
    // Auth-gated by middleware, so no robots override (unlike (auth)/onboarding).
    expect(appMetadata.robots).toBeUndefined();
  });

  it("titles /contacts via a metadata-only layout that renders children untouched", () => {
    expect(contactsMetadata.title).toBe("Contacts");
    const child = "list" as unknown as React.ReactNode;
    expect(ContactsTitleLayout({ children: child })).toBe(child);
  });
});
