"use client";

/**
 * LazyBentoLiveSwitch (iteration 5) — defers the switchable live tile island
 * until it nears the viewport (REFERENCES craft #7; below the fold, so it must
 * not hydrate on load — perf gate §11.4). The `import()` lives here (RSC
 * boundary); the server passes the serializable static fallback (the first panel
 * as completed DOM). NOT skipWhenReducedMotion — the tabs are FUNCTIONAL, not
 * decorative motion, so the switch stays drivable under reduced motion.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyBentoLiveSwitch({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import("./bento-live-switch").then((m) => ({
          default: m.BentoLiveSwitch,
        }))
      }
    />
  );
}
