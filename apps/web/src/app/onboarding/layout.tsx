import { Wordmark } from "@/components/shell/wordmark";

import { AppProviders } from "../app-providers";

/**
 * Onboarding shell (DESIGN.md G7): calm centered column, big friendly type,
 * one question per screen. Middleware guarantees a session; the wizard runs
 * OUTSIDE the (app) CompanyProvider on purpose — the company may not exist
 * yet, and each screen resolves its own state (use-onboarding-state.ts).
 *
 * Wraps AppProviders because the wizard steps use the TanStack Query client;
 * the (marketing) group does not, so it stays out of the root layout.
 */
export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-4 pb-16 pt-8 sm:pt-12">
        <div className="mb-8 flex justify-center">
          <Wordmark href="/" className="text-xl" />
        </div>
        <main className="flex-1">{children}</main>
      </div>
    </AppProviders>
  );
}
