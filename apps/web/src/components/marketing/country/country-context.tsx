"use client";

/**
 * The SITE-WIDE country context (owner ruling v1, 2026-07-08): one country for
 * the whole marketing app. A US visitor sees only the honest US story (10DLC,
 * the ~3 to 7 business day carrier wait, the one-time $29 fee); a Canadian
 * visitor sees only the Canada story (same-day texting, no registration, no
 * fee). Nothing pairs the two stories in the same copy.
 *
 * One provider backs everything: the nav CountrySelector, the first-visit
 * HeroCountryChooser, the branch helpers (CountryOnly / CountryText), and the
 * existing /pricing toggle (which now consumes THIS context via the thin
 * re-export at components/marketing/pricing/country-context.tsx). There is no
 * second provider anywhere; the nav control and the pricing toggle move the
 * same state.
 *
 */

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { readStoredCountry, writeStoredCountry } from './country-storage';
import type {Country} from './country-storage';

export { type Country } from './country-storage';


export interface CountryLabel {
  id: Country;
  /** The long label, e.g. "United States" (nav full mode, hero chooser). */
  label: string;
  /** The compact label for the nav bar, e.g. "US". */
  short: string;
}

/** The two choices, in control order (US first: the larger market, the default). */
export const COUNTRY_OPTIONS: readonly CountryLabel[] = [
  { id: "us", label: "United States", short: "US" },
  { id: "ca", label: "Canada", short: "CA" },
] as const;

interface CountryContextValue {
  country: Country;
  /** Set the country, mark the visitor as having chosen, and persist it. */
  setCountry: (country: Country) => void;
  /** True once the visitor has picked (this session, or via a stored choice). */
  hasChosen: boolean;
}

const CountryContext = createContext<CountryContextValue>({
  country: "us",
  setCountry: () => {},
  hasChosen: false,
});

export function CountryProvider({
  children,
  initialCountry = "us",
}: {
  children: ReactNode;
  initialCountry?: Country;
}) {
  const pathname = usePathname();
  const [chosenCountry, setChosenCountry] = useState<Country | null>(null);
  const country = chosenCountry ?? (pathname === "/canada" ? "ca" : initialCountry);
  const hasChosen = chosenCountry !== null;

  useEffect(() => {
    const stored = readStoredCountry(
      typeof window === "undefined" ? null : window.localStorage,
    );
    if (stored) setChosenCountry(stored);
  }, []);

  const setCountry = useCallback((next: Country) => {
    setChosenCountry(next);
    writeStoredCountry(
      typeof window === "undefined" ? null : window.localStorage,
      next,
    );
  }, []);

  const value = useMemo(
    () => ({ country, setCountry, hasChosen }),
    [country, setCountry, hasChosen],
  );

  return (
    <CountryContext.Provider value={value}>{children}</CountryContext.Provider>
  );
}

/**
 * Read the current country, the setter, and hasChosen. Returns the "us" default
 * outside a provider (it never throws), so any component that reads country
 * still renders standalone, e.g. in a unit test.
 */
export function useCountry(): CountryContextValue {
  return useContext(CountryContext);
}
