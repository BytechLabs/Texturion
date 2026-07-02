"use client";

/**
 * Client wrapper that defers the §3.4 steppable deep-dive island. The `import()`
 * lives here (RSC can't pass the `load` function across the boundary); the
 * server passes the serializable `fallback` (the completed <ThreadDeepDiveStatic/>)
 * and the script. Below the fold → loads on viewport approach; reduced-motion
 * keeps the static frame (skipWhenReducedMotion).
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";
import type { ThreadScript } from "@/components/marketing/thread-demo/script";

export function LazyThreadDeepDive({
  fallback,
  script,
}: {
  fallback: ReactNode;
  script: ThreadScript;
}) {
  return (
    <LazyIsland
      skipWhenReducedMotion
      fallback={fallback}
      load={() =>
        import("@/components/marketing/thread-demo/thread-deep-dive").then(
          (m) => ({ default: m.ThreadDeepDive }),
        )
      }
      componentProps={{ script }}
    />
  );
}
