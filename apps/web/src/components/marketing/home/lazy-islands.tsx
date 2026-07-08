"use client";

/**
 * Client wrappers that defer the home page's heavy interactive islands
 * (BLUEPRINT §3.1: the dynamic `import()` must live on the client side of the
 * RSC boundary; the server passes the meaningful static frame as `fallback`).
 *
 * - <LazyThreadDeepDive>: the §S4 steppable thread. Pure-motion island, so
 *   reduced-motion visitors keep the completed static frame and never pay for
 *   the chunk.
 * - <LazyMissedTextCalculator>: the §S8 calculator. Functional (not
 *   decorative), so it loads for everyone on viewport approach.
 */

import type { ReactNode } from "react";

import type { ThreadScript } from "@/components/marketing/thread-demo/script";
import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyThreadDeepDive({
  script,
  fallback,
}: {
  script: ThreadScript;
  fallback: ReactNode;
}) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import("@/components/marketing/thread-demo/thread-deep-dive").then(
          (m) => ({ default: m.ThreadDeepDive }),
        )
      }
      componentProps={{ script }}
      skipWhenReducedMotion
    />
  );
}

export function LazyMissedTextCalculator({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import(
          "@/components/marketing/interactive/missed-text-calculator"
        ).then((m) => ({ default: m.MissedTextCalculator }))
      }
    />
  );
}
