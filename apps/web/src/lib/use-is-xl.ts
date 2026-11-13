"use client";

import { useEffect, useState } from "react";

const XL = "(min-width: 1280px)";

function matchesXl(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(XL).matches
    : false;
}

/**
 * True at Tailwind's `xl` (>=1280px) — where the thread has a docked side
 * panel beside it; below that the same panel is a sheet over it. Read on the
 * first render, so a wide screen never paints the sheet first: everything that
 * asks renders only on the client, under CompanyProvider.
 */
export function useIsXl(): boolean {
  const [xl, setXl] = useState(matchesXl);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(XL);
    const update = () => setXl(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return xl;
}
