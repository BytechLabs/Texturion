"use client";

import { useEffect, useState } from "react";

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
 * SSR-safe: `false` on the server + first client paint (desktop-first, so no
 * hydration mismatch), then it adopts the real match on mount and tracks
 * viewport changes.
 */
export function useIsBelowMd(): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767.98px)");
    const update = () => setBelow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return below;
}
