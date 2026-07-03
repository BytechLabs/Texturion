"use client";

/**
 * LazyDispatchDesk (iteration 5) — defers the dispatch-desk island's JS until
 * after first paint (HERO-CONCEPT §2, §6: above-fold JS = 0 blocking; the island
 * is next/dynamic, hydrates AFTER first paint on idle).
 *
 * WHY a wrapper: the hero <DispatchHero> is a Server Component, so the `import()`
 * (a function) can't cross the RSC boundary. It lives here, in a Client
 * Component; the server passes only the serializable `fallback` (the completed
 * <DispatchDeskStatic/> DOM — the LCP / no-JS / reduced-motion frame).
 *
 * `eager` = load on idle (above the fold, must not block first paint / the H1
 * LCP). NOT skipWhenReducedMotion: unlike the pure-motion two-phones demo, this
 * island is FUNCTIONAL under reduced motion — it still exposes the quiet Replay
 * affordance (§5), it just never resets to raw or animates. So it loads, and the
 * island itself honors the reduced-motion branch.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyDispatchDesk({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      eager
      fallback={fallback}
      load={() =>
        import("./dispatch-desk").then((m) => ({ default: m.DispatchDesk }))
      }
    />
  );
}
