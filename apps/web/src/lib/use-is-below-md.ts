"use client";

import { useEffect, useState } from "react";

const BELOW_MD = "(max-width: 767.98px)";

function matchesBelowMd(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(BELOW_MD).matches
    : false;
}

/**
 * True when the viewport is below Tailwind's `md` breakpoint (<768px) — the
 * phone layout where a conversation is a full-screen pushed view.
 *
 * Use this to CONDITIONALLY MOUNT mobile-only content that must be absent from
 * the DOM at md+, not merely `display:none`. CSS-hiding is enough for layout,
 * but interactive widgets that scan their descendants (e.g. Radix menu
 * typeahead / roving focus) still "see" a `display:none` item and can target
 * it, so such items must not be mounted at all on desktop.
 *
 * Read on the first render, so a phone never paints the desktop header first:
 * everything that asks renders only on the client, under CompanyProvider.
 * `false` where there is no window. It tracks viewport changes after that.
 */
export function useIsBelowMd(): boolean {
  const [below, setBelow] = useState(matchesBelowMd);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(BELOW_MD);
    const update = () => setBelow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return below;
}
