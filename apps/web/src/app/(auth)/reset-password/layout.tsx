import type { Metadata } from "next";

import { EN } from "@/i18n/catalog";

/**
 * Per-route tab title for /reset-password (the "email me a link" screen). The
 * page is a client component, so the title lives in this metadata-only segment
 * layout. `robots: noindex` is inherited from the (auth) group layout; the
 * "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: EN.onboarding.tabResetPassword,
};

export default function ResetPasswordTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
