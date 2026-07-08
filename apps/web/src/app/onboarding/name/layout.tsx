import type { Metadata } from "next";

/**
 * Per-route tab title for the onboarding "name" step. The step page is a client
 * component, so its title lives in this metadata-only segment layout (renders
 * children untouched). `robots: noindex` is inherited from the onboarding group
 * layout; the "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "Your business name",
};

export default function NameStepTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
