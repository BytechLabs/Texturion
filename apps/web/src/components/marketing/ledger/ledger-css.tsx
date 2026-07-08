/**
 * Marketing-scoped drawn-affordance CSS. A single inert <style> for the small
 * hand-drawn marks the marketing surface still uses, kept out of globals.css
 * (which is shared with the signed-in app) and out of components/ui.
 *
 * DESIGN-DIRECTION §0 removals: the ledger costume is gone. This file no longer
 * carries the FILED-stamp press, the desk pulse ring, the ghost cursor, the
 * hero-H1 numbered-spine reservation, or the row-settle. What remains is honest:
 *  - .jt-meta        the small mono-flavored meta label voice (timestamps, labels);
 *  - the delivered-check self-draw (a real "delivered" tick on a reply);
 *  - the highlight-swipe (used once, on the problem H2 promise word);
 *  - the arrow-expand secondary CTA affordance.
 * Every animation is wrapped in prefers-reduced-motion: no-preference so reduced
 * motion gets the final frame. Zero JS, marketing-scoped.
 */

const CSS = `
/* ---- The meta label voice (timestamps, labels, eyebrows) ------------------ */
.jt-meta {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ---- The one highlight-swipe (the problem H2 promise word) ---------------- */
.jt-swipe {
  background-image: linear-gradient(
    to top,
    var(--marker-40, rgba(244, 214, 78, 0.4)) 0%,
    var(--marker-40, rgba(244, 214, 78, 0.4)) 34%,
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

/* ---- The self-drawing "delivered" check ----------------------------------- */
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

/* ---- Arrow-expand secondary CTA ------------------------------------------- */
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
`;

/**
 * One inert style node carrying the marketing drawn-affordance CSS. Rendered
 * once at the top of the home tree (server component, zero JS).
 */
export function LedgerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
