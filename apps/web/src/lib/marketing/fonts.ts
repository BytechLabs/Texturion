import localFont from "next/font/local";

/**
 * The MARKETING type trio (DESIGN-DIRECTION §3), locked by a real render pass
 * (the /fontlab route: the "Caught" hero headline set in every §3 display
 * candidate over the live palette, screenshotted at desktop + mobile). Chosen
 * for confidence + warmth + subject fit ("trades announce themselves to the
 * street, bold, hand-set lettering"):
 *
 *   Display  Basteleur (Velvetyne, OFL), a warm, heavy, hand-set serif that
 *            reads like painted van / yard-sign lettering. Two cuts:
 *              - Bold      → the headline weight (--font-display)
 *              - Moonlight → a lighter, sharper companion for composed emphasis
 *                            (--font-display-alt), the weight-contrast half of
 *                            the <Display> system (Basteleur has no true italic,
 *                            so emphasis is weight/optical contrast, not slant).
 *   Body     Hanken Grotesk (OFL, variable wght), a warm workhorse grotesque
 *            with more character than the marketing default; --font-body-mkt.
 *   Mono     Commit Mono (OFL), the "work-order honesty" mono for the numbers
 *            that matter ($29, phone numbers, timestamps); --font-mono-mkt.
 *
 * All four are self-hosted, latin-subset woff2 (scripts/subset-fonts.mjs →
 * src/app/fonts/marketing/), mounted as CSS variables on the (marketing)
 * route-group subtree ONLY (layout.tsx). The APP keeps Inter, nothing outside
 * the marketing subtree can resolve these variables (the two-surfaces rule).
 *
 * font-display: OPTIONAL on all three faces, chosen by measurement on the built
 * site (Lighthouse mobile Lantern + desktop). Two facts drove it:
 *
 *   1. CLS. With "swap", the three non-preloaded faces (Hanken body, Commit mono,
 *      Basteleur Moonlight) swap in after first paint and the size-adjusted
 *      fallback does not hold their box perfectly, which the layout-shifts audit
 *      caught as a ~0.07 CLS on DESKTOP (mobile was ~0.005). "optional" removes the
 *      post-paint swap entirely: a face is used only if it is ready inside the
 *      browser's ~100 ms block window, else the metric-matched fallback stays for
 *      that load and the font is cached for the next navigation, so NO swap can
 *      ever reflow. That drops desktop CLS to ~0.001 (mobile to 0) and lifts
 *      desktop Perf to 100. On a warm/fast connection (desktop, good mobile) the
 *      preloaded Basteleur Bold makes the window, so the signature hero lettering
 *      still renders; on a cold slow mobile load the hero paints in the SERIF
 *      fallback (still display-serif, not a sans) and upgrades next nav.
 *   2. LCP model. The hero H1 (the LCP element) is a text node. Neither "swap" nor
 *      "optional" moves the *modeled* mobile LCP much: measured, the mobile LCP is
 *      gated by Lantern's estimate of the React/Next framework-JS parse cost before
 *      first paint (simFCP ~1.66 s under the 4x CPU throttle), not by the font, so
 *      display mode is roughly LCP-neutral on mobile and we pick it on the CLS win.
 *      The one font lever that helped was the PRELOAD budget: preloading only the
 *      LCP face (Basteleur Bold), not all three above-the-fold faces, frees the
 *      critical path (see gen-font-preloads.mjs).
 *
 * ZERO-CLS FALLBACK METRICS: every face sets `adjustFontFallback` to the system
 * base whose PROPORTIONS it actually matches, so next/font emits a size-adjusted
 * `@font-face` (size-adjust + ascent/descent/line-gap overrides computed from the
 * real woff2 metrics) for the fallback. That makes the fallback occupy nearly the
 * SAME box as the web font. This is belt-and-suspenders with `display:optional`
 * (which already forbids any post-paint swap): even an in-window upgrade lands in a
 * box the fallback already sized, so nothing jumps. Basteleur is a serif → its
 * fallback is matched to "Times New Roman" (matching it against Arial, the sans
 * default, mis-sized the fallback and was the font shift the layout-shifts audit
 * flagged). Hanken and Commit are matched to "Arial". The `fallback` arrays name
 * the system faces the browser paints before the metric fallback resolves, in the
 * same category so nothing jumps.
 */

// Basteleur, the display face. Bold cut = headline weight, Moonlight = the
// lighter emphasis cut. Both exposed under one family with two weights so the
// <Display> component can flip weight for emphasis via a single variable.
export const basteleur = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/Basteleur-Moonlight.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../app/fonts/marketing/Basteleur-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-display",
  // OPTIONAL (see the font-display note above): the size-adjusted serif fallback
  // paints headline text (incl. the LCP hero H1) at first paint; the preloaded
  // Bold makes the block window on warm/fast loads so the hero lettering renders,
  // and there is never a post-paint swap to reflow. The H1 min-height reservation
  // holds the box regardless.
  display: "optional",
  // Serif display face: match the auto-generated metric fallback to a SERIF base
  // (Times New Roman), not the sans-serif default. This sizes the fallback box to
  // Basteleur's real metrics so the headline (incl. the LCP hero) never reflows;
  // the H1 min-height reservation then only has to hold the wrap.
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

// Hanken Grotesk, the body workhorse (variable wght, latin subset).
export const hankenGrotesk = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/HankenGrotesk-latin.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-body-mkt",
  // OPTIONAL: the body copy is below the LCP. Under "swap" Hanken swapping in was a
  // measured desktop-CLS contributor; "optional" paints the size-adjusted Arial
  // fallback and only upgrades within the block window, so no swap ever reflows.
  display: "optional",
  // Sans body face: size-adjusted fallback against Arial so paragraph and label
  // text holds its box (the body/mono reflow the audit flagged).
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

// Commit Mono, the "work-order" data mono ($29, phone, timestamps).
export const commitMono = localFont({
  src: [
    {
      path: "../../app/fonts/marketing/CommitMono-latin.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-mono-mkt",
  // OPTIONAL: the data mono ($29, phone numbers, timestamps) sits below the LCP.
  // Under "swap" Commit Mono swapping in was a measured desktop-CLS contributor;
  // "optional" paints the size-adjusted fallback and only upgrades within the block
  // window, so the numerals never reflow.
  display: "optional",
  // Size-adjusted fallback so the mono numerals ($29, timestamps) hold their box.
  adjustFontFallback: "Arial",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

/**
 * The (marketing) layout applies the three `.variable` members DIRECTLY in its
 * JSX (basteleur.variable, hankenGrotesk.variable, commitMono.variable), never a
 * pre-joined string. That is deliberate: next/font's compiler plugin only
 * registers a font for PRELOAD when it sees the font const's member accessed
 * statically in rendered JSX. A string concatenated here hid that access, so the
 * fonts never entered the font manifest and NONE were preloaded, the browser
 * discovered them late from the inlined @font-face, which delayed the hero
 * Basteleur swap (LCP lag) and shifted layout on swap. Referencing the members
 * directly in the layout fixes both. Mounting all three exposes --font-display /
 * --font-body-mkt / --font-mono-mkt to the marketing utilities in globals.css.
 */
