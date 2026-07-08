"use client";

/**
 * The country SELECTOR that lives in the marketing nav (desktop bar + mobile
 * sheet). A compact United States / Canada segmented control, always visible,
 * that sets the single site-wide country. It is a real radiogroup: click a
 * segment, or focus one and press an arrow key to move the selection. The
 * active segment is the cobalt pill (marketing chrome); focus rings come from
 * the shared frn-focus class.
 *
 * Two label modes:
 *   - compact (default): "US" / "CA", for the tight desktop bar.
 *   - full (`fullLabels`): "United States" / "Canada", for the mobile sheet.
 */

import { type KeyboardEvent, useRef } from "react";

import { cn } from "@/lib/utils";

import { COUNTRY_OPTIONS, type Country, useCountry } from "./country-context";

export function CountrySelector({
  className,
  fullLabels = false,
}: {
  className?: string;
  fullLabels?: boolean;
}) {
  const { country, setCountry } = useCountry();
  // Roving tabindex (WAI-ARIA radiogroup): only the checked radio is tabbable;
  // arrows move both selection and focus. Refs let us focus the sibling.
  const refs = useRef<Partial<Record<Country, HTMLButtonElement | null>>>({});

  function select(next: Country) {
    setCountry(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      select(country === "us" ? "ca" : "us");
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Where you run your business"
      className={cn(
        "inline-flex items-center rounded-full bg-[color:var(--fr-frost)] p-0.5",
        className,
      )}
    >
      {COUNTRY_OPTIONS.map((option) => {
        const selected = option.id === country;
        return (
          <button
            key={option.id}
            ref={(el) => {
              refs.current[option.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.aria}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(option.id)}
            onKeyDown={onKeyDown}
            className={cn(
              "frn-focus font-body-mkt inline-flex items-center justify-center rounded-full font-semibold transition-colors duration-200 ease-out",
              // Target size floor 24px (WCAG 2.5.8 AA) even in the compact bar.
              fullLabels
                ? "min-h-9 flex-1 px-4 py-2 text-center text-sm"
                : "min-h-6 px-2.5 py-1 text-xs leading-none",
              selected
                ? "bg-[color:var(--fr-cobalt)] text-white"
                : "text-[color:var(--fr-ink-70)] hover:text-[color:var(--fr-ink)]",
            )}
          >
            {fullLabels ? option.label : option.short}
          </button>
        );
      })}
    </div>
  );
}
