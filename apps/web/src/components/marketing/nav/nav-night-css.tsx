/**
 * "Quiet daylight" header skin (v3 spec §6 "Nav"): ONE inert <style> block,
 * class prefix "nxh-", mounted by <Nav> (the repo's ledger-css.tsx pattern).
 * The bar is LIGHT on every marketing page: white at 92% + backdrop blur, a
 * bottom hairline, --day-ink wordmark, --ink-70 links, and the one petrol
 * Start button. These rules are static, unconditional chrome, not a theme.
 *
 * Only what Tailwind utilities cannot express reliably lives here:
 *  - the bar ground (white at 92% + blur; solid fallback paints first);
 *  - the Besley-700 wordmark override (the shared <Wordmark> bakes its own
 *    font-weight utility; an unlayered rule wins deterministically);
 *  - the mobile-sheet surface (the Sheet portals to <body>, OUTSIDE
 *    .mkt-scope, and .mkt-scope's own unlayered ground must be outranked by
 *    specificity, not by style order);
 *  - the shared focus state (2px --petrol outline, 2px offset, per the light
 *    ground conventions; box-shadow:none kills any shadcn ring underneath);
 *  - the skip link's hidden-until-focus behavior.
 * Everything else (row hovers, panel surfaces, chip colors) is plain
 * var()-utilities in the nav components, the same approach as night/kit.tsx.
 */

const CSS = `
/* 48px bar: white at 92% opacity + backdrop blur (v3 spec §6). The solid
   paints first so engines without backdrop-filter still get a clean bar. */
.nxh-bar {
  color: var(--day-ink);
  background-color: #ffffff;
  background-color: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
/* The 1px bottom hairline that appears on scroll. */
.nxh-edge {
  border-color: rgba(11, 43, 38, 0.08);
}

/* Skip link (copy deck "Persistent chrome"): visually hidden until keyboard
   focus, then a petrol chip pinned under the top-left of the bar. */
.nxh-skip:not(:focus) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.nxh-skip:focus {
  position: absolute;
  top: 0.5rem;
  left: 1rem;
  z-index: 50;
  display: inline-block;
  padding: 0.375rem 0.75rem;
  border-radius: 8px;
  background-color: var(--petrol);
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 600;
  outline: 2px solid var(--petrol);
  outline-offset: 2px;
}

/* Wordmark: Besley 700 (v3 §3), --day-ink, with the "Text" accent in petrol.
   The .text-primary hook is the accent span inside the shared <Wordmark>. */
.nxh-wordmark {
  font-family: var(--font-display), Georgia, Cambria, "Times New Roman", serif;
  font-weight: 700;
  color: var(--day-ink);
}
.nxh-wordmark .text-primary {
  color: var(--petrol);
}

/* Shared chrome focus state (conventions: 2px petrol outline, 2px offset on
   light grounds). box-shadow:none suppresses shadcn/Radix ring shadows so
   exactly one focus affordance shows. */
.nxh-focus {
  outline: none;
}
.nxh-focus:focus-visible {
  outline: 2px solid var(--petrol);
  outline-offset: 2px;
  box-shadow: none;
}

/* The ONE petrol button (v3 spec §6): 8px radius, white 600 text. Hover
   deepens the rim to the sanctioned rgba(11,43,38,0.16) — no lifts, no new
   tints. */
.nxh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2rem;
  padding: 0 0.875rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background-color: var(--petrol);
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none;
}
.nxh-btn:hover {
  border-color: rgba(11, 43, 38, 0.16);
}
/* The mobile sheet's pinned CTA: same button, 44px tap height (G11). */
.nxh-btn-lg {
  height: 2.75rem;
  font-size: 1rem;
}

/* Mobile sheet surface: white. The Sheet portals to <body>, OUTSIDE
   .mkt-scope, so the call site re-adds the scope class (for tokens) + the
   marketing font variables. The doubled class outranks .mkt-scope's own
   unlayered ground (porcelain paper) by specificity, not by fragile style
   order. */
.mkt-scope.nxh-sheet {
  background-color: #ffffff;
  color: var(--day-ink);
  border-color: var(--rule-light);
}
/* The sheet's built-in close button (ui/sheet.tsx, not ours): give its
   keyboard focus the same petrol outline as the rest of the chrome. */
.mkt-scope.nxh-sheet button:focus-visible {
  outline: 2px solid var(--petrol);
  outline-offset: 2px;
  box-shadow: none;
}

@media (prefers-reduced-motion: no-preference) {
  .nxh-btn {
    transition: border-color 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
`;

/**
 * One inert style node for the light header chrome. Rendered once by <Nav>
 * (which is mounted once per marketing page by the (marketing) layout).
 */
export function NavNightCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
