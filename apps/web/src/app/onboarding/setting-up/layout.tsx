import type { Metadata } from "next";

/**
 * Per-route tab title for the onboarding "setting-up" screen (number
 * provisioning + checkout return). The page is a client component, so its title
 * lives in this metadata-only segment layout. `robots: noindex` is inherited
 * from the onboarding group layout; the "%s · Loonext" template comes from the
 * root.
 */
export const metadata: Metadata = {
  title: "Setting up",
};

export default function SettingUpTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
