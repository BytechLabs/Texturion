"use client";

/**
 * Client wrapper that defers the crew-size slider island (BLUEPRINT §3.9 / §8).
 * The `import()` lives here (RSC boundary); the server passes the serializable
 * default-state `fallback`. Loads on viewport approach. Used by both the home
 * pricing preview and the /pricing page.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import type { ReactNode } from "react";
import type { RivalSeatPricing } from "@/components/marketing/interactive/crew-size-slider";

import { LazyIsland } from "@/components/marketing/ui/lazy-island";

export function LazyCrewSizeSlider({
  fallback,
  perUserMonthly,
  minimumSeats,
  rival,
  locale = "en",
}: RivalSeatPricing & {
  fallback: ReactNode;
  locale?: MarketingLocale;
}) {
  return (
    <LazyIsland
      fallback={fallback}
      componentProps={{ perUserMonthly, minimumSeats, rival, locale }}
      load={() =>
        import("@/components/marketing/interactive/crew-size-slider").then(
          (m) => ({ default: m.CrewSizeSlider }),
        )
      }
    />
  );
}
