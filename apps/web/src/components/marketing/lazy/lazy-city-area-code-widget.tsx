"use client";

/**
 * Client wrapper that defers the city → area-code widget island (BLUEPRINT
 * §3.10). The `import()` lives here (RSC boundary) so the NANP lookup data
 * (@jobtext/shared table + onboarding city index) stays out of the initial
 * bundle; the server passes the serializable seeded-result `fallback`. Loads on
 * viewport approach.
 */

import type { ReactNode } from "react";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyCityAreaCodeWidget({ fallback }: { fallback: ReactNode }) {
  return (
    <LazyIsland
      fallback={fallback}
      load={() =>
        import("@/components/marketing/interactive/city-area-code-widget").then(
          (m) => ({ default: m.CityAreaCodeWidget }),
        )
      }
    />
  );
}
