"use client";

import { useEffect, useState } from "react";

/**
 * True on coarse-pointer (touch) devices. SSR-safe: renders false first, then
 * adopts the real value after mount (matchMedia is client-only), and tracks
 * live changes (e.g. a 2-in-1 switching modes). Used to give touch its own
 * interaction model where the hover/anchored-popover model breaks down
 * (tooltips, the composer's saved-replies picker — #120/#123).
 */
export function usePointerCoarse(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    setCoarse(query.matches);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
