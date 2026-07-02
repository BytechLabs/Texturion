"use client";

/**
 * Client wrapper that defers the §3.7 missed-text calculator island. The
 * `import()` lives here (RSC boundary); the server passes the serializable
 * default-state `fallback`. Functional (not pure motion), so it loads on
 * viewport approach even under reduced motion.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyMissedTextCalculator({
  fallback,
}: {
  fallback: ReactNode;
}) {
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
