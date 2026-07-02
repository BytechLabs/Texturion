"use client";

/**
 * Client wrapper that defers the §PR segment-counter island. The `import()`
 * lives here (RSC boundary); the server passes the serializable default-count
 * `fallback`. Loads on viewport approach.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazySegmentCounter({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import("./segment-counter").then((m) => ({ default: m.SegmentCounter }))
      }
    />
  );
}
