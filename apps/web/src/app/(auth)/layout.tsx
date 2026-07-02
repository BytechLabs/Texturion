import { Wordmark } from "@/components/shell/wordmark";

import { AppProviders } from "../app-providers";

/**
 * Auth screens (G10): calm, centered, one card, the wordmark above it.
 * Middleware bounces signed-in users off /login, /signup, /reset-password;
 * /update-password and /invite/[token] work in both states.
 *
 * Wraps AppProviders because the auth forms use the TanStack Query client;
 * the (marketing) group does not, so it stays out of the root layout.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
        <Wordmark href="/" className="text-xl" />
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
          {children}
        </div>
      </div>
    </AppProviders>
  );
}
