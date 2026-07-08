import type { Metadata } from "next";

/**
 * Per-route tab title for /login. The page itself is a client component (it
 * cannot export metadata), so the title lives in this metadata-only segment
 * layout — it renders children untouched. `robots: noindex` is inherited from
 * the (auth) group layout; the "%s · Loonext" template comes from the root.
 */
export const metadata: Metadata = {
  title: "Log in",
};

export default function LoginTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
