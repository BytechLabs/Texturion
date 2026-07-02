"use client";

/**
 * <RevealActivator> — ONE shared IntersectionObserver that drives every
 * `[data-reveal]` element on the page (BLUEPRINT §1.5 scroll reveals).
 *
 * Mounted once in the marketing layout. This replaces the previous per-<Reveal>
 * client island (each had its own observer + state + effect) — on the home page
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
 * the initial set ONCE — no MutationObserver watching the whole document (that
 * would re-scan on every DOM change the deferred islands / Radix nav make after
 * idle, which is a real main-thread cost under CPU throttle). Deferred islands
 * replace an already-revealed fallback in place, so they need no re-observation.
 */

import { useEffect } from "react";

const REVEALED = "true";

function revealAll() {
  document
    .querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")
    .forEach((el) => el.setAttribute("data-revealed", REVEALED));
}

export function RevealActivator() {
  useEffect(() => {
    // Reduced motion is already handled in CSS (forced visible); still mark them
    // revealed so state is consistent, and skip observing.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      revealAll();
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
    // observer edge case), reveal it so content is never stuck invisible.
    const failSafe = window.setTimeout(revealAll, 3000);

    return () => {
      observer.disconnect();
      window.clearTimeout(failSafe);
    };
  }, []);

  return null;
}
