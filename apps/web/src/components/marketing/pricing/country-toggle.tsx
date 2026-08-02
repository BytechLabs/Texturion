"use client";

/**
 * The COUNTRY TOGGLE for the /pricing plan section: United States (default) or
 * Canada, one clean tap. It branches the country-specific facts through the
 * country context (see country-context.tsx): the registration-fee line, the
 * "first month" math, and the activation-timeline card.
 *
 * Since #328 the same signal also picks the billing currency, so every figure
 * that reads it (<PlanPrice/>, and the fee in the helper below) moves with this
 * control. That is why there is still only one control: a currency selector
 * beside a country selector is a second thing that can disagree with the first,
 * and the visitor has already told us where they are.
 *
 * A real segmented radiogroup: arrow keys move the selection, the active
 * segment is a cobalt pill (marketing chrome, §2), and a short helper line
 * states the one fact that actually changes so the choice is legible before
 * the reader scrolls the receipt. No fake liveness, no em-dashes.
 */

import { type KeyboardEvent } from "react";

import { formatMoney, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";

import { cn } from "@/lib/utils";

import { useMarketingCurrency } from "./plan-price";
import {
  COUNTRY_OPTIONS,
  useCountry,
  type Country,
} from "./country-context";

/**
 * The one fact that actually changes with the choice.
 *
 * The fee is READ, not typed (#328). It only ever renders on the US branch,
 * where the figure has not moved in a year — which is exactly how a literal
 * survives a repricing and goes on contradicting the checkout underneath it.
 * A record of functions rather than a ternary so a third country cannot be
 * added without answering this question for it.
 */
const HELPER: Record<Country, (fee: string) => string> = {
  us: (fee) =>
    `One-time ${fee} registration, then US texting turns on in about a week.`,
  ca: () =>
    "No registration fee, and texting Canadian customers works the same day.",
};

export function CountryToggle({ className }: { className?: string }) {
  const { country, setCountry } = useCountry();
  const currency = useMarketingCurrency();
  const fee = formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);

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
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]",
                selected
                  ? "bg-[color:var(--fr-olive)] text-[color:var(--fr-on-olive)]"
                  : "text-[color:var(--fr-ink-70)] hover:text-[color:var(--fr-ink)]",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="fr-mono-data mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
        {HELPER[country](fee)}
      </p>
    </div>
  );
}
