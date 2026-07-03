"use client";

/**
 * <RevealActivator>, ONE shared IntersectionObserver that drives every
 * `[data-reveal]` element on the page (BLUEPRINT §1.5 scroll reveals).
 *
 * Mounted once in the marketing layout. This replaces the previous per-<Reveal>
 * client island (each had its own observer + state + effect), on the home page
 * that was ~28 hydrating islands, a measurable slice of the iteration-4 TBT
 * blocker. Now the <Reveal> wrappers are pure server DOM and this single tiny
 * island animates all of them:
 *  - Elements already in view on mount reveal immediately.
 *  - The rest reveal once-only as they scroll into ~20% visibility.
 *  - Fail-safe: reduced-motion (CSS already forces visible) and any environment
 *    without IntersectionObserver reveal everything at once; a mount-time sweep
 *    plus a short timeout guarantees nothing stays permanently hidden.
 *
 * All [data-reveal] elements are present at initial server render, so we observe
 * the initial set ONCE, no MutationObserver watching the whole document (that
 * would re-scan on every DOM change the deferred islands / Radix nav make after
 * idle, which is a real main-thread cost under CPU throttle). Deferred islands
 * replace an already-revealed fallback in place, so they need no re-observation.
 */

import { useEffect } from "react";

const REVEALED = "true";

/**
 * Fail-safe reveal: snap the remaining hidden elements to visible WITHOUT the
 * fade-rise transition. The transition fades opacity 0 -> 1, and a text element
 * caught mid-fade composites to a washed-out color that fails the contrast audit
 * (a false positive: the settled color is AA). Marking them `data-reveal-instant`
 * zeroes the transition (globals.css), so nothing is ever measured mid-fade. Used
 * only for elements the observer never got to (below the fold in a headless run).
 */
function revealAllInstant() {
  document
    .querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")
    .forEach((el) => {
      el.setAttribute("data-reveal-instant", REVEALED);
      el.setAttribute("data-revealed", REVEALED);
    });
}

export function RevealActivator() {
  useEffect(() => {
    // Reduced motion is already handled in CSS (forced visible); still mark them
    // revealed so state is consistent, and skip observing.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      revealAllInstant();
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-revealed", REVEALED);
            obs.unobserve(entry.target); // once-only
          }
        }
      },
      { threshold: 0.2 },
    );

    // Observe the initial set once. Anything already on screen fires on the
    // first callback tick, so above-the-fold reveals land right away.
    document
      .querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")
      .forEach((el) => observer.observe(el));

    // Fail-safe: if anything is still hidden a moment after load (e.g. an
    // observer edge case, or a headless run that never scrolls the below-fold
    // reveals into view), snap it visible WITHOUT the fade, so content is never
    // stuck invisible and no text is caught mid-fade by the contrast audit.
    const failSafe = window.setTimeout(revealAllInstant, 3000);

    return () => {
      observer.disconnect();
      window.clearTimeout(failSafe);
    };
  }, []);

  return null;
}
