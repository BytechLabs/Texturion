import type { Metadata } from "next";

import { Wordmark } from "@/components/shell/wordmark";

import { AppProviders } from "../app-providers";
import { OnboardingSignOut } from "./sign-out";

/**
 * Onboarding shell (DESIGN.md G7): calm centered column, big friendly type,
 * one question per screen. Middleware guarantees a session; the wizard runs
 * OUTSIDE the (app) CompanyProvider on purpose — the company may not exist
 * yet, and each screen resolves its own state (use-onboarding-state.ts).
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
      <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-4 pb-16 pt-8 sm:pt-12">
        {/* Wordmark centered; a quiet Sign out anchored right so a signed-in
            user is never trapped in the wizard (e.g. waiting on setting-up). */}
        <div className="relative mb-8 flex items-center justify-center">
          <Wordmark href="/" className="text-xl" />
          <div className="absolute right-0">
            <OnboardingSignOut />
          </div>
        </div>
        <main className="flex-1">{children}</main>
      </div>
    </AppProviders>
  );
}
