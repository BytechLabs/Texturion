import type { Metadata } from "next";

import "./globals.css";
// Validates the NEXT_PUBLIC_* configuration at module load: a missing variable
// fails `next dev` and `next build` loudly (SPEC §3, §10).
import "@/env";

export const metadata: Metadata = {
  title: "JobText — a shared SMS inbox for your crew",
  description:
    "One local business number your whole team can text from. Every incoming text becomes a conversation you can reply to, assign, tag, and close.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
