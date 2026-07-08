"use client";

/**
 * Shared prefers-reduced-motion hook for the thread-demo islands. Reduced
 * visitors see every beat at rest (the completed thread) and no scheduled
 * motion; the server pre-renders the same finished state for LCP / no-JS.
 */

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
