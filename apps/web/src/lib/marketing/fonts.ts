import { Fraunces } from "next/font/google";

/**
 * Fraunces — the MARKETING display face (VISUALS-V2 §5), defined ONCE here and
 * mounted as the `--font-display` CSS variable on the (marketing) route-group
 * subtree (layout.tsx). Marketing headline utilities (.jt-hero-h1, .display-hero,
 * .display-h2, .display-numeral, .font-display) resolve it; body/UI keep Inter.
 *
 * THE CWV FIX (VISUALS-V2 §7 — mobile Lighthouse >=90, CLS < 0.05). The first cut
 * shipped the full multi-axis + italic variable font under `display: "swap"`, which
 * caused two mobile-only regressions on the hero H1 (the LCP element):
 *   1. CLS ~0.17 — the display-optical Fraunces glyphs are far wider than the
 *      serif fallback, so the H1 rewrapped by a whole line at common phone widths
 *      (e.g. 412px: fallback 3 lines, Fraunces 4) when the font swapped in.
 *   2. LCP inflated — the H1's final paint waited on the late-swapping display font
 *      instead of painting immediately.
 *
 * The fix, at the root:
 *   - PAYLOAD: pin to the two weights headlines use (500/600), `normal` only, and
 *     DROP the `opsz`/`SOFT`/`WONK` axes — ~36 KiB latin subset vs. the ~233 KiB the
 *     first cut shipped. (next/font forbids `axes` + pinned `weight` together, so
 *     dropping the axes is what lets us pin the weight.) Fraunces' own old-style
 *     serif character carries the personality at headline scale; the axis nudges
 *     were imperceptible there next to their cost.
 *   - `display: "optional"` + `preload: false`: Fraunces is kept entirely OFF the
 *     hero's critical path. The H1 paints immediately from the HTML + inlined CSS
 *     in the fallback and NEVER late-swaps on that load (so no swap-induced reflow
 *     and no font tax on the LCP frame). Fraunces still paints on first load
 *     wherever it arrives in time (fast connections, warm cache) and always on
 *     repeat visits; on a cold slow-mobile first paint the headline shows in the
 *     serif fallback rather than Inter. Paired with the H1 `min-height` reservation
 *     (ledger-css.tsx), which fixes the box height so the optional font can never
 *     shift the sections below, this drives CLS to ~0 and takes the font off the
 *     LCP path. This trades a slice of first-paint display personality on the worst
 *     connections for the hard CWV gate — the gate wins (VISUALS-V2 §7: "Don't let
 *     the visual richness tank CWV").
 */
export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "optional",
  weight: ["500", "600"],
  style: "normal",
  variable: "--font-display",
  // preload:false — keep Fraunces OFF the critical path (VISUALS-V2 §7). This is
  // the rework's remaining mobile regression: the display font was preloaded at
  // VeryHigh priority, so on simulated Slow-4G its ~36 KB competed with the
  // document/CSS for bandwidth ahead of the LCP paint (~+0.9s LCP). With
  // `display:"optional"` the hero H1 already paints in the metric-matched serif
  // fallback and never late-swaps, so preloading Fraunces buys nothing for the
  // LCP frame — it only steals critical bandwidth. Dropping the preload lets the
  // font load lazily (it still applies on fast connections / warm cache / repeat
  // visits) while the LCP element paints from the HTML + inlined CSS alone.
  preload: false,
});
