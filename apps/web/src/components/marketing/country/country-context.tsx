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
 * SSR + persistence:
 *   - The default is "us", so a server render (and JS-disabled) is a complete,
 *     honest US page.
 *   - `initialCountry` exists so tests can render either branch deterministically
 *     with renderToStaticMarkup; production never passes it (defaults to "us").
 *   - After hydration the provider adopts a persisted choice from localStorage
 *     (see country-storage.ts). First client render === server render ("us"),
 *     so there is no hydration mismatch; a returning Canadian swaps one frame
 *     later (brief flash, acceptable, same as the pricing toggle).
 *   - `hasChosen` is false until the visitor picks a country (or a prior choice
 *     is adopted from storage). The HeroCountryChooser reads it to know whether
 *     the first-visit affordance still belongs on screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  readStoredCountry,
  writeStoredCountry,
  type Country,
} from "./country-storage";

export type { Country };

export interface CountryLabel {
  id: Country;
  /** The long label, e.g. "United States" (nav full mode, hero chooser). */
  label: string;
  /** The compact label for the nav bar, e.g. "US". */
  short: string;
  /** A screen-reader-friendly long form used in aria strings. */
  aria: string;
}

/** The two choices, in control order (US first: the larger market, the default). */
export const COUNTRY_OPTIONS: readonly CountryLabel[] = [
  { id: "us", label: "United States", short: "US", aria: "United States" },
  { id: "ca", label: "Canada", short: "CA", aria: "Canada" },
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

/**
 * Wraps the whole (marketing) subtree (mounted in the marketing layout).
 * `initialCountry` defaults to "us" (the SSR default the owner ruled); it exists
 * only so tests can render a branch deterministically.
 */
export function CountryProvider({
  children,
  initialCountry = "us",
}: {
  children: ReactNode;
  initialCountry?: Country;
}) {
  const [country, setCountryState] = useState<Country>(initialCountry);
  const [hasChosen, setHasChosen] = useState(false);

  // After hydration, adopt any persisted choice. First render stays "us" (the
  // SSR default), so this never causes a hydration mismatch; it only swaps a
  // returning visitor one frame later.
  useEffect(() => {
    const stored = readStoredCountry(
      typeof window !== "undefined" ? window.localStorage : null,
    );
    if (stored) {
      setCountryState(stored);
      setHasChosen(true);
    }
  }, []);

  const setCountry = useCallback((next: Country) => {
    setCountryState(next);
    setHasChosen(true);
    writeStoredCountry(
      typeof window !== "undefined" ? window.localStorage : null,
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
