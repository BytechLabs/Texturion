"use client";

/**
 * The one-time, first-visit country chooser for the home hero. Calm and inline
 * (never a modal popup): a short prompt and two buttons. Picking one sets the
 * site-wide country and, because setCountry marks the visitor as having chosen,
 * the affordance dismisses itself and never returns (the choice persists to
 * localStorage).
 *
 * Placement contract for the home crew: render this BELOW the H1. It is present
 * in the server HTML for a first-time visitor (hasChosen is false on SSR), so a
 * first-time visitor sees it from first paint with no layout shift, and the H1
 * above it stays the LCP element and never moves. A returning visitor's stored
 * choice is adopted one frame after hydration, so the chooser collapses out
 * (below the H1); the H1 is unaffected.
 *
 * Accessible: a labeled group of two plain buttons, each keyboard-operable and
 * focus-ringed via frn-focus.
 */

import { cn } from "@/lib/utils";

import { COUNTRY_OPTIONS, useCountry } from "./country-context";

export function HeroCountryChooser({ className }: { className?: string }) {
  const { setCountry, hasChosen } = useCountry();

  if (hasChosen) return null;

  return (
    <div
      role="group"
      aria-label="Where do you run your business"
      className={cn(
        "inline-flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-[color:var(--fr-frost)] px-4 py-3",
        className,
      )}
    >
      <span className="fr-mono-data text-[0.8125rem] text-[color:var(--fr-ink-70)]">
        Where do you run your business?
      </span>
      <div className="flex items-center gap-2">
        {COUNTRY_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-label={option.aria}
            onClick={() => setCountry(option.id)}
            className={cn(
              "frn-focus font-body-mkt rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-[color:var(--fr-ink)] transition-colors duration-200 ease-out",
              "hover:bg-[color:var(--fr-cobalt)] hover:text-white",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
