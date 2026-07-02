"use client";

/**
 * Client wrapper that defers the crew-size slider island (BLUEPRINT §3.9 / §8).
 * The `import()` lives here (RSC boundary); the server passes the serializable
 * default-state `fallback`. Loads on viewport approach. Used by both the home
 * pricing preview and the /pricing page.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyCrewSizeSlider({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import("@/components/marketing/interactive/crew-size-slider").then(
          (m) => ({ default: m.CrewSizeSlider }),
        )
      }
    />
  );
}
