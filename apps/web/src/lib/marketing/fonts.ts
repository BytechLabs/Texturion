import localFont from "next/font/local";

/**
 * #612 — SELF-HOSTED, not fetched from Google at build time.
 *
 * These three were `next/font/google`, which downloads the woff2 during
 * `next build`. That made every build of the marketing site — including the
 * release build that ships to production — depend on fonts.gstatic.com being
 * reachable at that moment, and it failed twice in a row on 2026-08-14:
 *
 *   NextFontError: Failed to fetch `Spline Sans Mono` from Google Fonts.
 *
 * Nothing about the SERVED page ever needed Google: next/font self-hosts the
 * result either way. The dependency was purely a build-time fetch, which is
 * exactly what made it avoidable rather than inherent. The app's own faces
 * (Inter, Golos) have always been local; the licences for all three of these
 * were already committed beside them.
 *
 * The files are the LATIN subset of each family's variable woff2, taken from
 * the same Google CSS the plugin was reading, with the `unicode-range` Google
 * publishes for that subset declared below so a browser skips the download for
 * text it cannot cover.
 */

/**
 * The MARKETING v4 type trio (docs/marketing/DESIGN-DIRECTION.md §3,
 * "FIRST RESPONSE"), the same three faces the direction specifies:
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
 * page (CLS 0 from fonts). next/font emits the preload links itself, and
 * `adjustFontFallback` (default on for local faces too) pins a metric-matched
 * fallback so the pre-upgrade paint occupies the same box — which is the half
 * of the strategy that has to survive the move off Google, since it is what
 * keeps the layout still.
 */

/*
 * The `unicode-range` below is REPEATED in all three calls, and it has to be.
 * next/font's compiler plugin refuses anything that is not an explicitly
 * written literal — a shared `const latinOnly = [...]` fails the build with
 * "Font loader values must be explicitly written literals". So the obvious
 * de-duplication is not available here; three copies is the supported shape.
 *
 * It is Google's own published range for the `latin` subset, matching the file
 * each `src` points at.
 */

export const display = localFont({
  src: "../../app/fonts/BricolageGrotesque.woff2",
  // The variable file carries opsz, wdth AND wght — the direction asks for the
  // opsz and wdth axes, so a static instance would not do.
  weight: "200 800",
  variable: "--font-display",
  display: "optional",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const body = localFont({
  src: "../../app/fonts/HankenGrotesk.woff2",
  weight: "100 900",
  variable: "--font-body",
  display: "optional",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

export const mono = localFont({
  src: "../../app/fonts/SplineSansMono.woff2",
  // 400 and 500 are the two the mono law uses; the file is variable across
  // 300-700, so the range is declared rather than the pair.
  weight: "300 700",
  variable: "--font-mono",
  display: "optional",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
});

/**
 * The (marketing) layout applies the three `.variable` members DIRECTLY in
 * its JSX (display.variable, body.variable, mono.variable), never a
 * pre-joined string: next/font's compiler plugin only registers a font for
 * preload when it sees the member accessed statically in rendered JSX.
 */
