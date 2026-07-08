"use client";

/**
 * Country context for the /pricing plan section (US default, Canada one tap).
 *
 * The pricing page leads with US-specific facts (the one-time $29 registration
 * fee, the "$58 first month then $29" math, the 3 to 7 business day carrier
 * wait). Those confuse Canadian buyers, whose story is genuinely simpler: no
 * registration fee, and texting Canadian customers works the same day. This
 * context lets a single toggle near the top of the plan section branch ONLY
 * the country-specific facts across the components that carry them:
 *   - the plan builder receipt (the registration-fee line + the first-month
 *     math), and
 *   - the activation timeline card (US carrier wait vs Canada day-one).
 *
 * The plan builder's base + add-on prices never change (USD, plus tax). Only
 * the three country-specific facts above move.
 *
 * SSR / progressive enhancement: the default value is "us" (the larger market),
 * so a server render with no provider, and the page with JavaScript disabled,
 * both stand as a complete US pricing page. useCountry() returns that default
 * outside a provider (it never throws), so components that read country still
 * render standalone (e.g. in unit tests). The toggle is purely additive on top.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Country = "us" | "ca";

export interface CountryLabel {
  id: Country;
  /** The control's short label, e.g. "United States". */
  label: string;
  /** A screen-reader-friendly long form used in aria strings. */
  aria: string;
}

/** The two choices, in toggle order (US first: the larger market, the default). */
export const COUNTRY_OPTIONS: readonly CountryLabel[] = [
  { id: "us", label: "United States", aria: "United States" },
  { id: "ca", label: "Canada", aria: "Canada" },
] as const;

interface CountryContextValue {
  country: Country;
  setCountry: (country: Country) => void;
}

const CountryContext = createContext<CountryContextValue>({
  country: "us",
  setCountry: () => {},
});

/**
 * Wraps the plan section so the toggle, the receipt, and the timeline share one
 * country. `initialCountry` defaults to "us" (the SSR default the owner ruled);
 * it exists so tests can render either branch deterministically.
 */
export function CountryProvider({
  children,
  initialCountry = "us",
}: {
  children: ReactNode;
  initialCountry?: Country;
}) {
  const [country, setCountry] = useState<Country>(initialCountry);
  const value = useMemo(() => ({ country, setCountry }), [country]);
  return (
    <CountryContext.Provider value={value}>{children}</CountryContext.Provider>
  );
}

/** Read the current country (and setter). Returns the "us" default outside a provider. */
export function useCountry(): CountryContextValue {
  return useContext(CountryContext);
}
