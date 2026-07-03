/**
 * Ledger identity — marketing-scoped styles (iteration 5, ART-DIRECTION.md).
 *
 * WHY this file exists: the brief forbids touching `globals.css` tokens and
 * `components/ui/**` (both shared with the signed-in app). Every new marketing
 * identity device — the FILED stamp keyframe, the H1 highlight-swipe, the
 * ledger-ruled baseline, the desk pulse ring, the ghost cursor, the numeral —
 * is therefore defined HERE, in one inert `<style>` node, under the `jt-ledger`
 * class namespace so nothing leaks into the app. It consumes only existing
 * design tokens (`--color-primary`, `--color-border`, `--radius`, the stone/
 * amber scale via CSS vars) — no new global token is invented.
 *
 * It is rendered ONCE (LedgerStyles) high in the home tree. All classes are
 * prefixed `jt-` and every animation is wrapped in `@media (prefers-reduced-
 * motion: no-preference)` so reduced-motion users get the final frame with no
 * motion (ART-DIRECTION §5, HERO-CONCEPT §5). Zero JS, zero runtime cost.
 */

const CSS = `
/* ---- The ledger-ruled H1 baseline + the one highlight-swipe (§4.1) -------- */
/* The hero H1 sits on a thin petrol hairline like a ledger line; one key noun
   carries a petrol highlight-swipe that animates once (renders pre-swiped under
   reduced-motion). Marketing-only, so the size can exceed the app's display
   scale to hit HERO-CONCEPT's clamp(44px,5.5vw,72px) without editing globals. */
.jt-hero-h1 {
  /* The signature hero headline in the MARKETING display face (VISUALS-V2 §5):
     Fraunces — a warm old-style serif — so the hero reads characterful; this is
     where "personality" lives. --font-display is set on the (marketing) layout
     subtree; if it is ever unresolved this falls back to the serif stack (never
     Inter), so the hero is never a bland grotesque wall.

     CLS/LCP fix (VISUALS-V2 §7): the display font is now the pinned regular
     optical master (no opsz/SOFT/WONK axes) whose metrics next/font's fallback
     matches, and we RESERVE the H1 box height so a font swap can never rewrap it
     into the section below. min-height is expressed in em at the element's own
     font-size (line-height 1.04), so N*1.04em reserves exactly N lines at every
     clamp() size. The reserved line count tracks Fraunces' real wrap per
     breakpoint (measured): the metric-matched fallback wraps to the same or fewer
     lines and paints into the reserved box, so nothing below it moves. */
  font-family: var(--font-display), ui-serif, Georgia, Cambria, "Times New Roman",
    serif;
  font-size: clamp(44px, 5.5vw, 72px);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.04;
  /* Default (single-column, up to sm): Fraunces wraps to 4 lines from ~341px up;
     at the very narrow end (<=340px) it needs 5. Reserve 5 lines as the floor so
     even a 320px device is shift-free — the small bottom slack fills the instant
     Fraunces loads (well within the fold), and 4-line widths just carry one line
     of harmless reserved space until swap. */
  min-height: calc(5 * 1.04em);
}
/* >=430px single-column: Fraunces settles at 4 lines; drop the reservation to 4
   so there is no lingering empty line on the common phone widths. */
@media (min-width: 430px) {
  .jt-hero-h1 { min-height: calc(4 * 1.04em); }
}
/* >=640px (sm) single-column: the wider measure takes Fraunces to 3 then 2 lines;
   reserve 3 to cover the 640–767px band where Fraunces is 3 and the fallback 2. */
@media (min-width: 640px) {
  .jt-hero-h1 { min-height: calc(3 * 1.04em); }
}
/* >=768px single-column: Fraunces and the fallback both wrap to 2 lines. */
@media (min-width: 768px) {
  .jt-hero-h1 { min-height: calc(2 * 1.04em); }
}
/* >=1024px (lg): the hero becomes a 2-column grid; the narrower left column takes
   the H1 back to 4 lines, and Fraunces + fallback agree there (desktop CLS was
   already ~0.005). Reserve 4 to stay robust to sub-pixel wrap. */
@media (min-width: 1024px) {
  .jt-hero-h1 { min-height: calc(4 * 1.04em); }
}
.jt-swipe {
  background-image: linear-gradient(
    to top,
    color-mix(in oklab, var(--color-primary) 22%, transparent) 0%,
    color-mix(in oklab, var(--color-primary) 22%, transparent) 34%,
    transparent 34%
  );
  background-repeat: no-repeat;
  background-position: 0 100%;
  background-size: 100% 100%;
  border-radius: 2px;
  padding: 0 0.06em;
}
@media (prefers-reduced-motion: no-preference) {
  .jt-swipe {
    background-size: 0% 100%;
    animation: jt-swipe-in 620ms cubic-bezier(0.22, 1, 0.36, 1) 320ms forwards;
  }
  @keyframes jt-swipe-in {
    from { background-size: 0% 100%; }
    to { background-size: 100% 100%; }
  }
}

/* ---- The ledger meta / tabular texture (craft #1) ------------------------ */
.jt-meta {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "cv11" 1, "ss01" 1, "tnum" 1;
}

/* ---- The FILED stamp — the one signature motion beat (§5.1) --------------- */
/* scale(1.08 -> 1) + opacity(0 -> 1), 150ms ease-out, compositor-only. Under
   reduced-motion the stamp is simply present (final frame), never animated. */
.jt-stamp {
  transform: rotate(-8deg);
}
@media (prefers-reduced-motion: no-preference) {
  .jt-stamp[data-stamped="true"] {
    animation: jt-stamp-in 150ms ease-out both;
  }
  @keyframes jt-stamp-in {
    from { opacity: 0; transform: rotate(-8deg) scale(1.18); }
    to { opacity: 1; transform: rotate(-8deg) scale(1); }
  }
}

/* ---- The desk pulse ring + ghost cursor (HERO-CONCEPT §4) ----------------- */
@media (prefers-reduced-motion: no-preference) {
  .jt-pulse::after {
    content: "";
    position: absolute;
    inset: -4px;
    border-radius: 9999px;
    border: 2px solid var(--color-primary);
    animation: jt-pulse 1200ms ease-out 2;
    pointer-events: none;
  }
  @keyframes jt-pulse {
    0% { opacity: 0.7; transform: scale(0.9); }
    100% { opacity: 0; transform: scale(1.5); }
  }
  .jt-ghost {
    transition: transform 700ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease;
  }
}

/* ---- The self-drawing "done" check (craft #10) --------------------------- */
.jt-check-path {
  stroke-dasharray: 20;
  stroke-dashoffset: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .jt-check[data-drawn="true"] .jt-check-path {
    stroke-dashoffset: 20;
    animation: jt-draw 400ms ease-out 60ms forwards;
  }
  @keyframes jt-draw {
    to { stroke-dashoffset: 0; }
  }
}

/* ---- Arrow-expand secondary CTA (craft #14) ------------------------------ */
.jt-arrow-link .jt-arrow {
  width: 0;
  opacity: 0;
  overflow: hidden;
  transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms ease;
}
.jt-arrow-link:hover .jt-arrow,
.jt-arrow-link:focus-visible .jt-arrow {
  width: 1.1em;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .jt-arrow-link .jt-arrow { width: 1.1em; opacity: 1; transition: none; }
}

/* ---- Filed-row settle (State B arrival) ---------------------------------- */
@media (prefers-reduced-motion: no-preference) {
  .jt-settle {
    animation: jt-settle 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes jt-settle {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
}
`;

/**
 * One inert style node carrying every marketing-scoped ledger device. Rendered
 * once at the top of the home tree (server component, zero JS). Safe to ship in
 * SSR HTML — it is plain CSS, no hydration.
 */
export function LedgerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
