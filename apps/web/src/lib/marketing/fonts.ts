import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  Spline_Sans_Mono,
} from "next/font/google";

/**
 * The MARKETING v4 type trio (docs/marketing/DESIGN-DIRECTION.md §3,
 * "FIRST RESPONSE"), loaded per the direction's exact next/font/google spec:
 *
 *   Display  Bricolage Grotesque (variable, with the opsz + wdth axes): the
 *            big plainspoken grotesque. 800 is the only display weight
 *            (H1, H2, the wordmark).
 *   Body     Hanken Grotesk (variable): body 400, emphasis 500, UI labels
 *            600, H3/card titles 700.
 *   Mono     Spline Sans Mono 400/500: every countable truth (the mono law):
 *            prices, counts, timestamps, phone numbers, datelines, eyebrows.
 *            Always tabular (the utilities set font-variant-numeric).
 *
 * Mounted as CSS variables (--font-display / --font-body / --font-mono) on
 * the (marketing) route-group subtree ONLY (layout.tsx). The APP keeps its
 * own faces; nothing outside the marketing subtree can resolve these
 * variables (the two-surfaces rule).
 *
 * font-display strategy (direction §7: "display: swap off, use fallback
 * adjust"): `optional` paints the size-adjusted fallback and upgrades only
 * inside the browser's block window, so a late font can never reflow the
 * page (CLS 0 from fonts). next/font/google self-hosts the woff2 at build
 * time and emits the preload links itself; `adjustFontFallback` (default on)
 * pins a metric-matched fallback so the pre-upgrade paint occupies the same
 * box.
 */

export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "wdth"],
  display: "optional",
});

export const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  display: "optional",
});

export const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "optional",
});

/**
 * The (marketing) layout applies the three `.variable` members DIRECTLY in
 * its JSX (display.variable, body.variable, mono.variable), never a
 * pre-joined string: next/font's compiler plugin only registers a font for
 * preload when it sees the member accessed statically in rendered JSX.
 */
