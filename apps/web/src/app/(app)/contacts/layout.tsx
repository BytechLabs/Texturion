import type { Metadata } from "next";

/**
 * Per-route tab title for /contacts. The page is a client component, so its
 * title lives in this metadata-only segment layout (it renders children
 * untouched); the "%s · Loonext" template comes from the (app) group layout.
 */
export const metadata: Metadata = {
  title: "Contacts",
};

export default function ContactsTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
