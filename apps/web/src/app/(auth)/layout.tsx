import type { Metadata } from "next";
import { headers } from "next/headers";

import { AuthHelp } from "@/components/auth/auth-help";
import { Wordmark } from "@/components/shell/wordmark";
import { AUTH_LOCALE_HEADER, authLocale } from "@/i18n/auth-locale";
import { LocaleProvider } from "@/i18n/provider";

import { AppProviders } from "../app-providers";
import { RootDocument, metadata as rootMetadata } from "../root-document";

export { viewport } from "../root-document";

/**
 * Auth screens (G10): calm, centered, one card, the wordmark above it.
 * Middleware bounces signed-in users off /login, /signup, /reset-password;
 * /update-password and /invite/[token] work in both states.
 *
 * Wraps AppProviders because the auth forms use the TanStack Query client;
 * the (marketing) group does not, so it stays out of the root layout.
 */

export const metadata: Metadata = {
  ...rootMetadata,
  // Auth pages are transactional surfaces, not content — keep them out of
  // search indexes. Per-route titles live in each segment's metadata-only
  // layout (the pages are client components) and flow through the root
  // "%s · Loonext" template.
  robots: { index: false, follow: false },
};
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = authLocale(requestHeaders.get(AUTH_LOCALE_HEADER), requestHeaders.get("accept-language"));
  const auth = (
    <LocaleProvider deviceLocale={locale}>
      <AppProviders>
        {/* §3.5: one centered card on the stone-50 field, generous air above the
            form (≥15vh top) so the first taste of the app feels calm and
            premium; 24px card padding; the wordmark sits quietly above. */}
        <div className="flex min-h-svh flex-col items-center px-4 pb-16 pt-[15vh]">
          <Wordmark href="/" className="mb-8 text-xl" />
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
            {children}
          </div>
          <AuthHelp />
        </div>
      </AppProviders>
    </LocaleProvider>
  );
  return <RootDocument locale={locale}>{auth}</RootDocument>;
}
