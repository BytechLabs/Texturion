/**
 * v4 "FIRST RESPONSE" header chrome (DESIGN-DIRECTION §4 "Nav"): ONE inert
 * <style> block, class prefix "frn-", mounted by <Nav>. The bar is Signal
 * White with NO border (Law 10); past 24px of scroll it condenses to a
 * floating frosted pill (white at 88% + backdrop blur, the one card shadow).
 * Wordmark per the brand rule (#206): Golos Text SemiBold ink, second o
 * olive; links Hanken 500; the one cobalt "Get your number" pill.
 *
 * Only what Tailwind utilities cannot express reliably lives here:
 *  - the frosted pill ground (solid fallback paints first for engines
 *    without backdrop-filter);
 *  - the shared focus state (2px cobalt outline, 2px offset; box-shadow:none
 *    kills any shadcn ring underneath);
 *  - the compact cobalt nav CTA (one shape, reused by the mobile sheet);
 *  - the mobile-sheet surface (the Sheet portals to <body>, OUTSIDE
 *    .mkt-scope, so specificity must beat the scope's own ground);
 *  - the skip link's hidden-until-focus behavior.
 */

const CSS = `
/* The resting bar: Signal White, borderless (Law 10). */
.frn-bar {
  background-color: var(--fr-ground);
  color: var(--fr-ink);
}
/* Past 24px: the bar ground clears and the nav row floats as a frosted
   pill. The solid white paints first so engines without backdrop-filter
   still get a clean pill. */
.frn-bar[data-condensed="true"] {
  background-color: transparent;
}
.frn-pill {
  background-color: #ffffff;
  background-color: rgba(255, 255, 255, 0.88);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: var(--fr-shadow-card);
}

/* Skip link: visually hidden until keyboard focus, then a cobalt chip
   pinned under the top-left of the bar. */
.frn-skip:not(:focus) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.frn-skip:focus {
  position: absolute;
  top: 0.5rem;
  left: 1rem;
  z-index: 50;
  display: inline-block;
  padding: 0.375rem 0.75rem;
  border-radius: 999px;
  background-color: var(--fr-cobalt);
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 600;
  outline: 2px solid var(--fr-cobalt);
  outline-offset: 2px;
}

/* Wordmark (#206, brand/README.md): Golos Text SemiBold, Dispatch Ink, with
   the SECOND o in the brand olive (the .frn-o span — always text spans,
   never an image). <Nav> mounts the --font-golos variable. */
.frn-wordmark {
  font-family: var(--font-golos), ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--fr-ink);
}
.frn-wordmark .frn-o {
  color: #66801f;
}

/* Shared chrome focus state: 2px cobalt outline, 2px offset (§7; yellow is
   not used on this site). box-shadow:none suppresses shadcn/Radix ring
   shadows so exactly one focus affordance shows. */
.frn-focus {
  outline: none;
}
.frn-focus:focus-visible {
  outline: 2px solid var(--fr-cobalt);
  outline-offset: 2px;
  box-shadow: none;
}

/* The one cobalt pill, nav-compact geometry (§4 Buttons: cobalt ground,
   white Hanken 600 text, hover deepens to the cobalt-deep step). */
.frn-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  padding: 0 1.125rem;
  border-radius: 999px;
  background-color: var(--fr-cobalt);
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none;
}
.frn-cta:hover {
  background-color: var(--fr-cobalt-deep);
}
/* The mobile sheet's pinned CTA: same pill, 48px tap height. */
.frn-cta-lg {
  height: 3rem;
  font-size: 1rem;
}

/* Mobile sheet surface: white. The Sheet portals to <body>, OUTSIDE
   .mkt-scope, so the call site re-adds the scope class (for tokens) + the
   marketing font variables; the doubled class outranks .mkt-scope's own
   ground by specificity. */
.mkt-scope.frn-sheet {
  background-color: #ffffff;
  color: var(--fr-ink);
  border: none;
}
/* The sheet's built-in close button (ui/sheet.tsx, not ours): give its
   keyboard focus the same cobalt outline as the rest of the chrome. */
.mkt-scope.frn-sheet button:focus-visible {
  outline: 2px solid var(--fr-cobalt);
  outline-offset: 2px;
  box-shadow: none;
}

@media (prefers-reduced-motion: no-preference) {
  .frn-cta {
    transition: background-color 200ms ease-out;
  }
}
`;

/**
 * One inert style node for the v4 header chrome. Rendered once by <Nav>
 * (mounted once per marketing page by the (marketing) layout).
 */
export function NavCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
