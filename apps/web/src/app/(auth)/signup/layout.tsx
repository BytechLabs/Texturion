import type { Metadata } from "next";

/**
 * Per-route tab title for /signup. The page is a client component, so the
 * title lives in this metadata-only segment layout (it renders children
 * untouched). `robots: noindex` is inherited from the (auth) group layout; the
 * "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "Create your account",
};

export default function SignupTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
