import { describe, expect, it, vi } from "vitest";

// The onboarding group layout pulls in the app shell providers and the sign-out
// control; we only assert its static `metadata`, so stub those imports to keep
// this a node-only unit test (the default component is never rendered).
vi.mock("@/components/shell/wordmark", () => ({ Wordmark: () => null }));
vi.mock("./sign-out", () => ({ OnboardingSignOut: () => null }));
vi.mock("../app-providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

import BusinessTitleLayout, {
  metadata as businessMetadata,
} from "./business/layout";
import { metadata as onboardingMetadata } from "./layout";
import NameTitleLayout, { metadata as nameMetadata } from "./name/layout";
import NumberTitleLayout, { metadata as numberMetadata } from "./number/layout";
import PlanTitleLayout, { metadata as planMetadata } from "./plan/layout";
import PortTitleLayout, { metadata as portMetadata } from "./port/layout";
import SettingUpTitleLayout, {
  metadata as settingUpMetadata,
} from "./setting-up/layout";
import TextingTitleLayout, {
  metadata as textingMetadata,
} from "./texting/layout";

describe("onboarding group metadata", () => {
  it("is noindex and gives the dispatcher a default title", () => {
    expect(onboardingMetadata.robots).toEqual({ index: false, follow: false });
    expect(onboardingMetadata.title).toEqual({
      default: "Get started · Loonext",
      template: "%s · Loonext",
    });
  });
});

describe("per-step onboarding tab titles", () => {
  it("names each wizard step and inherits robots (no override)", () => {
    expect(nameMetadata.title).toBe("Your business name");
    expect(numberMetadata.title).toBe("Your business number");
    expect(businessMetadata.title).toBe("About your business");
    expect(textingMetadata.title).toBe("How you'll text");
    expect(planMetadata.title).toBe("Choose your plan");
    expect(settingUpMetadata.title).toBe("Setting up");
    expect(portMetadata.title).toBe("Port your number");
    for (const m of [
      nameMetadata,
      numberMetadata,
      businessMetadata,
      textingMetadata,
      planMetadata,
      settingUpMetadata,
      portMetadata,
    ]) {
      expect(m.robots).toBeUndefined();
    }
  });

  it("renders children untouched (metadata-only segment layouts)", () => {
    const child = "step" as unknown as React.ReactNode;
    expect(NameTitleLayout({ children: child })).toBe(child);
    expect(NumberTitleLayout({ children: child })).toBe(child);
    expect(BusinessTitleLayout({ children: child })).toBe(child);
    expect(TextingTitleLayout({ children: child })).toBe(child);
    expect(PlanTitleLayout({ children: child })).toBe(child);
    expect(SettingUpTitleLayout({ children: child })).toBe(child);
    expect(PortTitleLayout({ children: child })).toBe(child);
  });
});
