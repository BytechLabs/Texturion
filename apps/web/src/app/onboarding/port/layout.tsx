import type { Metadata } from "next";

import { EN } from "@/i18n/catalog";

/**
 * Per-route tab title for the "port your number" sub-wizard (its index plus the
 * carrier / address / timing screens, which share this title). The pages are
 * client components, so the title lives in this metadata-only segment layout.
 * `robots: noindex` is inherited from the onboarding group layout; the
 * "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: EN.onboarding.tabPortYourNumber,
};

export default function PortStepTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
