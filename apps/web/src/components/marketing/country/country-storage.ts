/**
 * Pure persistence helpers for the site-wide country choice.
 *
 * These are deliberately framework-free (no React, no "use client") so the
 * persistence contract can be unit-tested against a plain fake Storage in the
 * node test environment (the repo has no jsdom). The provider in
 * country-context.tsx is the only production caller; it passes
 * window.localStorage.
 *
 * Owner ruling: the SSR default is always "us". A returning visitor's choice
 * lives in localStorage under one key and is adopted client-side after
 * hydration (a brief flash for a returning Canadian is acceptable, the same as
 * the existing /pricing toggle).
 */

export type Country = "us" | "ca";

/** The single localStorage key that holds the visitor's country choice. */
export const COUNTRY_STORAGE_KEY = "loonext.country";

/** Narrow an unknown value (e.g. a raw localStorage string) to a Country. */
export function isCountry(value: unknown): value is Country {
  return value === "us" || value === "ca";
}

/**
 * Read the persisted country. Returns null when nothing valid is stored, or
 * when storage is unavailable (SSR, private mode, a thrown SecurityError). The
 * presence of a valid value doubles as the "has chosen" flag: we only ever
 * write this key in response to an explicit visitor choice.
 */
export function readStoredCountry(
  storage: Pick<Storage, "getItem"> | null | undefined,
): Country | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(COUNTRY_STORAGE_KEY);
    return isCountry(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persist the visitor's country choice. Best-effort: a storage failure (quota,
 * private mode) is swallowed so a choice never throws in the UI.
 */
export function writeStoredCountry(
  storage: Pick<Storage, "setItem"> | null | undefined,
  country: Country,
): void {
  if (!storage) return;
  try {
    storage.setItem(COUNTRY_STORAGE_KEY, country);
  } catch {
    // Persistence is best-effort; the in-memory choice still stands this visit.
  }
}
