"use client";

/**
 * Client wrapper that defers the two-phones hero island (BLUEPRINT §3.1).
 *
 * WHY a wrapper and not <LazyIsland> directly at the call site: the hero section
 * is a Server Component, and the `load` function (`() => import(...)`) cannot be
 * passed across the RSC boundary to a Client Component. So the `import()` lives
 * HERE, inside a Client Component; the server only passes the serializable
 * `fallback` (the completed <TwoPhonesStatic/> DOM). eager = load after idle
 * (above the fold, so it must not block first paint / the H1 LCP);
 * skipWhenReducedMotion = the static completed composition IS the reduced-motion
 * experience, so the animated JS never loads then.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyTwoPhonesHero({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      eager
      skipWhenReducedMotion
      fallback={fallback}
      load={() =>
        import("@/components/marketing/thread-demo/two-phones-hero").then(
          (m) => ({ default: m.TwoPhonesHero }),
        )
      }
    />
  );
}
