import localFont from "next/font/local";

/**
 * The MARKETING type trio (docs/marketing/DESIGN-DIRECTION.md, "Open all
 * night"), all SIL-OFL variable faces, latin-subset woff2, self-hosted:
 *
 *   Display  Besley (indestructible type / Owen Earl), a Clarendon revival:
 *            the letterform of hardware signage and painted truck doors.
 *            Variable 700-900; 900 is the hero weight, 700-800 headings.
 *   Body     Public Sans (USWDS), the plain-spoken register: built for US
 *            government services, tabular figures available. 300-700.
 *   Mono     Martian Mono (Evil Martians), the instrument-panel mono for
 *            everything countable: clock eyebrows, ticks, segments, dollars.
 *            Variable weight + width (75-112.5%, condensed for rail stamps).
 *
 * Mounted as CSS variables on the (marketing) route-group subtree ONLY
 * (layout.tsx). The APP keeps Inter; nothing outside the marketing subtree can
 * resolve these variables (the two-surfaces rule).
 *
 * font-display: OPTIONAL on all three, a MEASURED decision carried over from
 * the previous trio (see git history of this file for the full Lighthouse
 * numbers): "swap" reflows the page when the non-preloaded faces land
 * (~0.07 desktop CLS); "optional" paints the size-adjusted fallback and only
 * upgrades inside the browser's ~100 ms block window, so no swap can ever
 * reflow. The preloaded LCP face (Besley, gen-font-preloads.mjs) makes the
 * window on warm/fast loads so the hero lettering renders; cold slow loads
 * paint the metric-matched serif fallback and upgrade next navigation.
 * `adjustFontFallback` pins each fallback to the base whose proportions the
 * face matches (Besley is a slab SERIF → Times New Roman; the other two →
 * Arial), so the fallback occupies nearly the same box and nothing jumps.
 */

// Besley, the display face. One variable file carries 700-900; 900 = hero H1,
// 800 = section H2, 700 = card H3.
export const besley = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/Besley-latin.woff2",
      weight: "700 900",
      style: "normal",
    },
  ],
  variable: "--font-display",
  display: "optional",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

// Public Sans, the body workhorse (variable wght 300-700, latin subset).
export const publicSans = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/PublicSans-latin.woff2",
      weight: "300 700",
      style: "normal",
    },
  ],
  variable: "--font-body-mkt",
  display: "optional",
  adjustFontFallback: "Arial",
  fallback: [
    "Arial",
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "sans-serif",
  ],
});

// Martian Mono, the instrument-panel data mono (variable wght 100-800 with a
// 75-112.5% width axis; the night-rail clock stamps use the condensed end via
// font-stretch at the call site).
export const martianMono = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/MartianMono-latin.woff2",
      weight: "100 800",
      style: "normal",
    },
  ],
  variable: "--font-mono-mkt",
  display: "optional",
  adjustFontFallback: "Arial",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  declarations: [{ prop: "font-stretch", value: "75% 112.5%" }],
});

/**
 * The (marketing) layout applies the three `.variable` members DIRECTLY in its
 * JSX (besley.variable, publicSans.variable, martianMono.variable), never a
 * pre-joined string. That is deliberate: next/font's compiler plugin only
 * registers a font for PRELOAD when it sees the font const's member accessed
 * statically in rendered JSX. A string concatenated here hid that access, so
 * the fonts never entered the font manifest and NONE were preloaded; the
 * browser discovered them late from the inlined @font-face, which delayed the
 * hero display-face swap (LCP lag) and shifted layout on swap. Referencing the
 * members directly in the layout fixes both.
 */
