"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for time-based copy (e.g. the provisioning wait ladder in
 * {@link provisioningWaitCopy}): returns `Date.now()` and re-renders every
 * `intervalMs` so the UI advances WITHOUT refetching data. The interval is
 * cleared on unmount. 30s is plenty for minute-scale copy tiers.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
