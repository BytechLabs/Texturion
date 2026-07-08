import type { Metadata } from "next";

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

export const metadata: Metadata = {
  // Auth pages are transactional surfaces, not content — keep them out of
  // search indexes. Per-route titles live in each segment's metadata-only
  // layout (the pages are client components) and flow through the root
  // "%s · Loonext" template.
  robots: { index: false, follow: false },
};
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      {/* §3.5: one centered card on the stone-50 field, generous air above the
          form (≥15vh top) so the first taste of the app feels calm and
          premium; 24px card padding; the wordmark sits quietly above. */}
      <div className="flex min-h-svh flex-col items-center px-4 pb-16 pt-[15vh]">
        <Wordmark href="/" className="mb-8 text-xl" />
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
          {children}
        </div>
      </div>
    </AppProviders>
  );
}
