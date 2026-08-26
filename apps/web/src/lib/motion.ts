/**
 * Motion helpers (DESIGN.md G2/G11: `prefers-reduced-motion` disables all
 * motion).
 *
 * The globals.css media query only zeroes CSS transition/animation durations —
 * it does NOT touch scripted Web Animations API animations created with
 * `element.animate()`, which run with their JS-specified duration regardless.
 * Any WAAPI animation must therefore consult this helper before running.
 */

/**
 * True when the viewer asked the OS to reduce motion. SSR-safe: returns
 * `false` when `window`/`matchMedia` is unavailable (server, or very old
 * browsers) so the animation path is a no-op rather than a crash.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keep a functional scroll, but make it immediate when motion was reduced.
 *
 * CSS `scroll-behavior: auto` does not override an explicit
 * `scrollIntoView({ behavior: "smooth" })` / `scrollTo({ behavior: "smooth" })`.
 * Scripted scrolls therefore have the same obligation as WAAPI animations: ask
 * the media query before starting motion.
 */
export function reducedMotionScrollBehavior(
  behavior: ScrollBehavior = "smooth",
): ScrollBehavior {
  return behavior === "smooth" && prefersReducedMotion() ? "auto" : behavior;
}
