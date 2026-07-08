import type { Metadata } from "next";

/**
 * Per-route tab title for /update-password (the "choose a new password" screen
 * reached from the recovery link). The page is a client component, so the title
 * lives in this metadata-only segment layout. `robots: noindex` is inherited
 * from the (auth) group layout; the "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "Set a new password",
};

export default function UpdatePasswordTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
