/**
 * <CityAreaCodeWidgetStatic>, the area-code widget seeded to its default
 * (Toronto → 416), as pure server DOM. The LCP-neutral / no-JS / pre-hydration
 * frame so the Canada beat shows a real local-number result before (and
 * without) the interactive island, and, importantly, so the NANP lookup data
 * (@loonext/shared table + the onboarding city index) stays OUT of the initial
 * bundle until the widget nears the viewport. <LazyIsland> swaps in the typable
 * combobox on viewport approach.
 *
 * The seeded result mirrors the interactive widget's initial state (Toronto,
 * area code 416, Ontario, Canada) so the swap is seamless.
 */

import { MapPin, Search } from "lucide-react";

export function CityAreaCodeWidgetStatic() {
  return (
    <div className="rounded-[10px] border border-border bg-card p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <p className="text-[14px] font-medium text-foreground">
        Find your local area code
      </p>
      <div className="relative mt-2">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        {/* Inert input, the interactive island replaces it with a real combobox. */}
        <div className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-[15px] text-foreground">
          Toronto
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-lg bg-primary/5 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] text-foreground">
            A{" "}
            <span className="font-semibold tabular-nums text-primary">
              (416)
            </span>{" "}
            number for <span className="font-medium">Toronto</span>
            {/* --graphite (8.3:1 on the petrol-tinted panel); muted-foreground
                was 4.45:1 here, a hair under AA. */}
            <span className="text-[color:var(--graphite)]">. Ontario</span>
          </p>
          <p className="text-[12px] text-[color:var(--graphite)]">
            Canadian number, texting works the same day you sign up.
          </p>
        </div>
      </div>

      <a
        href="/signup"
        className="mt-4 inline-flex items-center gap-1 text-[15px] font-medium text-primary underline-offset-2 hover:underline"
      >
        Get your (416) number →
      </a>

      <p className="mt-3 text-[12px] text-muted-foreground">
        Real numbering data, the same table the app uses to pick your number.
      </p>
    </div>
  );
}
