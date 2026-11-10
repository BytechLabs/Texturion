"use client";

import { useEffect, useState } from "react";

/**
 * True at Tailwind's `xl` (>=1280px) — where the thread has a docked side
 * panel beside it; below that the same panel is a sheet over it. False on the
 * server and first client paint, so there is no hydration mismatch.
 */
export function useIsXl(): boolean {
  const [xl, setXl] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1280px)");
    const update = () => setXl(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return xl;
}
