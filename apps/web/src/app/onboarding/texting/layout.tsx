import type { Metadata } from "next";

/**
 * Per-route tab title for the onboarding "texting" step. The step page is a
 * client component, so its title lives in this metadata-only segment layout.
 * `robots: noindex` is inherited from the onboarding group layout; the
 * "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "How you'll text",
};

export default function TextingStepTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
