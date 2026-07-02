/**
 * Shared visual grammar for the JobText marketing art system
 * (VISUALS §1B/§1C/§2). This module is the single source of truth that makes the
 * spot illustrations and infographics provably COHESIVE — every SVG imports these
 * constants instead of hand-picking values, so the whole set carries one stroke
 * weight, one corner radius, and one bounded 2–3-tone palette.
 *
 * The grammar:
 * - STROKE: 1.75 everywhere (matches the app's lucide icons, DESIGN.md G2).
 * - RADIUS: 10px language from the app (DESIGN.md G2 `--radius`), scaled down for
 *   small motifs via `RADIUS_SM`.
 * - COLOR DEPTH: exactly three inks — petrol (the accent), a stone line ink, and
 *   a faint stone fill — plus amber reserved ONLY for honesty/wait accents
 *   (VISUALS §2). Everything themes via CSS custom properties, so a single set of
 *   SVGs is correct in both light and dark: consumers wrap the SVG in a
 *   themed context and these vars resolve to the right tokens.
 *
 * Theming approach: rather than `currentColor` (which collapses to one ink), each
 * SVG paints with `var(--art-*)` custom properties that default to the light
 * palette and are overridden under `.dark`. The defaults live in the class
 * `ART_VARS` applied on every root <svg>; the dark overrides ride the same class
 * via a `.dark &` rule expressed with Tailwind's arbitrary-property syntax. This
 * keeps each component a pure, cache-friendly SVG with zero per-instance color
 * props while staying fully themeable.
 */

/** The one stroke weight for the entire system (VISUALS §1B). */
export const STROKE = 1.75;

/** Corner radii — the app's 10px language, and a small-motif variant. */
export const RADIUS = 10;
export const RADIUS_SM = 6;

/**
 * The palette custom-property names. Each art root sets these; consumers never
 * touch them directly. Kept as a const map so refactors are typo-proof.
 */
export const ART_VAR = {
  /** The accent ink — petrol. Lines, fills-at-alpha, key shapes. */
  petrol: "--art-petrol",
  /** A soft petrol tint fill (teal-50 in light, teal-950-ish on dark). */
  petrolSoft: "--art-petrol-soft",
  /** The neutral line ink — stone (drawn edges, secondary structure). */
  line: "--art-line",
  /** The faint neutral fill — stone (panels, ground planes). */
  fill: "--art-fill",
  /** The surface an object sits on (card white / stone-900 on dark). */
  surface: "--art-surface",
  /** The honesty/wait accent — amber. Reserved for the timeline wait segment. */
  amber: "--art-amber",
  /** A soft amber tint fill. */
  amberSoft: "--art-amber-soft",
} as const;

/**
 * Tailwind classes that (a) install the light-mode defaults for the ART_VAR
 * palette on the root <svg>, and (b) override them under `.dark`. Applied by
 * <ArtRoot> so every illustration and infographic shares one themed palette.
 *
 * Colors are the app's real tokens (globals.css): petrol = teal-700 / teal-500
 * on dark; line/fill = stone; amber = the registration-banner accent. Written as
 * arbitrary Tailwind properties so they compile with the rest of the utility CSS
 * (no new globals.css entry needed — the art system is fully self-contained).
 */
export const ART_VARS = [
  // Light defaults.
  "[--art-petrol:#0f766e]",
  "[--art-petrol-soft:#ccfbf1]", // teal-100 — a touch stronger than teal-50 so it reads
  "[--art-line:#a8a29e]", // stone-400
  "[--art-fill:#f5f5f4]", // stone-100
  "[--art-surface:#ffffff]", // white
  "[--art-amber:#d97706]", // amber-600
  "[--art-amber-soft:#fef3c7]", // amber-100
  // Dark overrides — the app's dark tokens.
  "dark:[--art-petrol:#2dd4bf]", // teal-400/500 range, reads on ink
  "dark:[--art-petrol-soft:#134e4a]", // teal-900
  "dark:[--art-line:#57534e]", // stone-600
  "dark:[--art-fill:#292524]", // stone-800
  "dark:[--art-surface:#1c1917]", // stone-900
  "dark:[--art-amber:#f59e0b]", // amber-500
  "dark:[--art-amber-soft:#451a03]", // amber-950
].join(" ");

/** Shorthand `var(...)` accessors for use in SVG `fill`/`stroke` attributes. */
export const ink = {
  petrol: `var(${ART_VAR.petrol})`,
  petrolSoft: `var(${ART_VAR.petrolSoft})`,
  line: `var(${ART_VAR.line})`,
  fill: `var(${ART_VAR.fill})`,
  surface: `var(${ART_VAR.surface})`,
  amber: `var(${ART_VAR.amber})`,
  amberSoft: `var(${ART_VAR.amberSoft})`,
} as const;

/** Common props every art component accepts (clean, consistent API surface). */
export interface ArtProps {
  /** Sizing/positioning classes on the root <svg>. */
  className?: string;
  /** Accessible label. Omit (or pass "") to mark the art purely decorative. */
  title?: string;
  /**
   * Opt into the once-on-scroll reveal draw-in (VISUALS §2 motion). When false
   * (default) the art renders at its final frame — callers that want motion wrap
   * with <ArtReveal> or set `animate`. Reduced-motion always shows the final
   * frame.
   */
  animate?: boolean;
}
