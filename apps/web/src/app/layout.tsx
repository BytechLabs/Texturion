import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";
// Validates the NEXT_PUBLIC_* configuration at module load: a missing variable
// fails `next dev` and `next build` loudly (SPEC §3, §10).
import "@/env";

import { Providers } from "./providers";

// Inter variable, self-hosted via next/font (DESIGN.md G2: "latin subset"). The
// stylistic sets (cv11, ss01) are applied in globals.css via
// font-feature-settings.
//
// The woff2 files are LATIN-SUBSET (scripts/subset-fonts.mjs) — ~109 KiB roman
// + ~120 KiB italic, down from the 344 + 379 KiB full-unicode originals (the
// iteration-4 font-payload regression). `unicodeRange` declares that latin
// coverage so the browser can skip either file on a page that renders no
// matching character, and never blocks on a range this font can't serve. The
// range mirrors the codepoints kept by the subsetter (Google-Fonts "latin" plus
// the arrows/math/✓ the marketing copy renders as text). next/font requires a
// literal here, so the range is inlined (keep it in sync with
// scripts/subset-fonts.mjs's LATIN_UNICODES).
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
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+21D2,U+2212,U+2215,U+2248,U+2260,U+2264-2265,U+2713-2714,U+FEFF,U+FFFD",
    },
  ],
});

export const metadata: Metadata = {
  // Canonical/OG resolution base + the "%s · Loonext" title template
  // (BLUEPRINT §11.1). The marketing home overrides this with an absolute
  // title; every other marketing page supplies just the "%s" half.
  metadataBase: new URL("https://loonext.com"),
  title: {
    default: "Loonext: a shared SMS inbox for your crew",
    template: "%s · Loonext",
  },
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
    title: "Loonext",
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
        {/* Global providers = ThemeProvider only (app-providers.tsx carries the
            Query/tooltip/toaster/service-worker weight for signed-in routes). */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
