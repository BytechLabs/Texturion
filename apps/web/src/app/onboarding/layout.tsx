import type { Metadata } from "next";

import { GateHeader } from "@/components/shell/gate-header";

import { AppProviders } from "../app-providers";

/**
 * Onboarding shell (DESIGN.md G7): calm centered column, big friendly type,
 * one question per screen. Middleware guarantees a session; the wizard runs
 * OUTSIDE the (app) CompanyProvider on purpose — the company may not exist
 * yet, and each screen resolves its own state (use-onboarding-state.ts).
 *
 * Chrome is the shared GateHeader (#207): wordmark, the workspace switcher,
 * and sign out — a multi-workspace user who lands here for a non-onboarded
 * workspace must always be able to switch back or sign out. Never re-implement
 * that affordance per gate; the law test in src/app/gate-layouts.test.tsx
 * pins this layout to the shared component.
 *
 * Wraps AppProviders because the wizard steps use the TanStack Query client;
 * the (marketing) group does not, so it stays out of the root layout.
 */

export const metadata: Metadata = {
  // The wizard is a transactional, signed-in surface — keep it out of search
  // indexes (child step layouts inherit this). The default title covers the
  // dispatcher/index; each step's metadata-only layout supplies its own "%s"
  // that the root "%s · Loonext" template wraps. The pages are client
  // components, so the titles cannot live on them.
  title: { default: "Get started · Loonext", template: "%s · Loonext" },
  robots: { index: false, follow: false },
};
export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <div className="flex min-h-svh flex-col">
        <GateHeader />
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-16 pt-8 sm:pt-12">
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </AppProviders>
  );
}
