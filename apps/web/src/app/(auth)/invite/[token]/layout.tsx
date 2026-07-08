import type { Metadata } from "next";

/**
 * Per-route tab title for /invite/[token] (accepting a teammate invitation).
 * The page is a client component, so the title lives in this metadata-only
 * segment layout. `robots: noindex` is inherited from the (auth) group layout;
 * the "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "Accept your invitation",
};

export default function InviteTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
