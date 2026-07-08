"use client";

/**
 * The COUNTRY TOGGLE for the /pricing plan section: United States (default) or
 * Canada, one clean tap. It branches only the country-specific facts through
 * the country context (see country-context.tsx): the registration-fee line,
 * the "first month" math, and the activation-timeline card. Base and add-on
 * prices are identical for both (USD, plus tax) and never move.
 *
 * A real segmented radiogroup: arrow keys move the selection, the active
 * segment is a cobalt pill (marketing chrome, §2), and a short helper line
 * states the one fact that actually changes so the choice is legible before
 * the reader scrolls the receipt. No fake liveness, no em-dashes.
 */

import { type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import {
  COUNTRY_OPTIONS,
  useCountry,
  type Country,
} from "./country-context";

const HELPER: Record<Country, string> = {
  us: "One-time $29 registration, then US texting turns on in about a week.",
  ca: "No registration fee, and texting Canadian customers works the same day.",
};

export function CountryToggle({ className }: { className?: string }) {
  const { country, setCountry } = useCountry();

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      setCountry(country === "us" ? "ca" : "us");
    }
  }

  return (
    <div className={className}>
      <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
        Where are your customers?
      </p>
      <div
        role="radiogroup"
        aria-label="Where you text: United States or Canada"
        className="mt-3 inline-flex rounded-full bg-[color:var(--fr-frost)] p-1"
      >
        {COUNTRY_OPTIONS.map((option) => {
          const selected = option.id === country;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setCountry(option.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "rounded-full px-4 py-2 text-[0.875rem] font-semibold transition-colors duration-200 ease-out",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]",
                selected
                  ? "bg-[color:var(--fr-cobalt)] text-white"
                  : "text-[color:var(--fr-ink-70)] hover:text-[color:var(--fr-ink)]",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="fr-mono-data mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
        {HELPER[country]}
      </p>
    </div>
  );
}
