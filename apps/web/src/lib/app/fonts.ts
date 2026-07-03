import localFont from "next/font/local";

/**
 * The APP primary sans: Golos Text (Golos type foundry, SIL OFL 1.1), the
 * uncommon UI-grade grotesque that REPLACES Inter in the (app) subtree
 * (APP-SHELL-REDESIGN.md §2). Self-hosted, latin-subset woff2, variable wght, so
 * every weight the app uses (400 body → 700 marks) renders from one file, with
 * true tabular figures (tnum) for the timestamps, phone numbers, and receipt
 * meta the app aligns in columns.
 *
 * Scoped like the marketing trio (the two-surfaces rule): the (app) layout mounts
 * `.variable` on the app subtree ONLY, exposing --font-golos there. Marketing
 * keeps Basteleur/Hanken/Commit; the app never resolves those, and nothing
 * outside the app subtree resolves --font-golos.
 *
 * The woff2 is the latin subset produced by scripts/subset-app-fonts.mjs (~41
 * KiB, down from the ~180 KiB full source). `unicodeRange` declares that latin
 * coverage so the browser can skip the file on a surface that renders no matching
 * character. The range mirrors the codepoints kept by the subsetter (Google-Fonts
 * "latin" plus the arrows/math/✓ that may appear as text). next/font requires a
 * literal here, so the range is inlined — keep it in sync with
 * scripts/subset-app-fonts.mjs's LATIN_UNICODES.
 *
 * The Golos source variable axis is wght 400-900; we declare that real range so
 * next/font never asks for a weight the axis cannot serve (the fallback covers
 * the lighter placeholder weights the app never actually paints).
 */
export const golosText = localFont({
  src: [
    {
      path: "../../app/fonts/GolosText.woff2",
      weight: "400 900",
      style: "normal",
    },
  ],
  variable: "--font-golos",
  display: "swap",
  // Metric-matched fallback so the app text holds its box until Golos resolves
  // (no reflow on swap). Golos is a grotesque sans → match Arial's proportions.
  adjustFontFallback: "Arial",
  fallback: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica",
    "Arial",
    "sans-serif",
  ],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+21D2,U+2212,U+2215,U+2248,U+2260,U+2264-2265,U+2713-2714,U+FEFF,U+FFFD",
    },
  ],
});
