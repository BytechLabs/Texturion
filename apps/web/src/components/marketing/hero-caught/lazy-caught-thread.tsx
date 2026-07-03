"use client";

/**
 * LazyCaughtThread, defers the "catch" animation island until after first paint
 * (the H1 is the LCP; the thread must not block it). The hero is a Server
 * Component, so the dynamic import lives here in a Client Component; the server
 * passes only the serializable `fallback` (the finished CaughtThreadStatic DOM,
 * which is the LCP / no-JS / reduced-motion frame).
 *
 * `eager` = hydrate AFTER the LCP paint settles (window `load` then idle), so the
 * one motion island never competes with the hero LCP for the main thread.
 * `skipWhenReducedMotion` = for reduced-motion visitors the static caught frame
 * IS the finished experience, so the animation island never loads at all (no
 * replay to offer), saving its JS download + hydration for those users (§5).
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyCaughtThread({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      eager
      skipWhenReducedMotion
      fallback={fallback}
      load={() =>
        import("./caught-thread").then((m) => ({ default: m.CaughtThread }))
      }
    />
  );
}
