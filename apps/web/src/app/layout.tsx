import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";
// Validates the NEXT_PUBLIC_* configuration at module load: a missing variable
// fails `next dev` and `next build` loudly (SPEC §3, §10).
import "@/env";

import { ServiceWorkerRegistrar } from "@/components/notifications/service-worker-registrar";

import { Providers } from "./providers";

// Inter variable, self-hosted via next/font (DESIGN.md G2). The stylistic
// sets (cv11, ss01) are applied in globals.css via font-feature-settings.
const inter = localFont({
  src: [
    {
      path: "./fonts/InterVariable.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "./fonts/InterVariable-Italic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobText — a shared SMS inbox for your crew",
  description:
    "One local business number your whole team can text from. Every incoming text becomes a conversation you can reply to, assign, tag, and close.",
  // Favicons + PWA icons (G9). The SVG favicon is the runtime default; the
  // unread-title manager (lib/push/use-unread-title.ts) swaps its href to
  // /favicon-unread.svg when unread conversations exist. The .ico is the
  // legacy fallback; PNGs come from scripts/generate-icons.mjs.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iOS PWA meta tags (G9): installable from Safari share sheet, opens
  // standalone with the petrol status bar treatment.
  appleWebApp: {
    capable: true,
    title: "JobText",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Petrol theme color for the browser chrome (G9 PWA groundwork).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F766E" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1211" },
  ],
  width: "device-width",
  initialScale: 1,
  // Safe-area padding on the mobile tab bar needs viewport-fit=cover (G3).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes mutates <html class> before React
    // hydrates (class-strategy dark mode, G2).
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        {/* /sw.js registration (G9: push + offline shell). Render-null and
            prompt-free — permission requests stay in settings (G8). */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
