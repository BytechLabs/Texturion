"use client";

/**
 * Client wrapper that defers a large bento tile's auto-playing thread island
 * (BLUEPRINT §3.6). The `import()` lives here (RSC boundary); the server passes
 * the serializable completed-thread `fallback` and the script. Below the fold →
 * loads on viewport approach; reduced-motion keeps the static frame.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";
import type { ThreadScript } from "@/components/marketing/thread-demo/script";

export function LazyTileThread({
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
        import("@/components/marketing/thread-demo/thread-demo").then((m) => ({
          default: m.ThreadDemo,
        }))
      }
      componentProps={{
        script,
        framing: "desktop" as const,
        hideControls: true,
        bodyClassName: "min-h-[200px]",
      }}
    />
  );
}
