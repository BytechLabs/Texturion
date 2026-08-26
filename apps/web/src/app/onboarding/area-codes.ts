import {
  NANP_AREA_CODES,
  type Locale,
  type NanpCountry,
  type NanpGeographicEntry,
} from "@loonext/shared";

import {
  areaCodeRegionAliases,
  areaCodeRegionName,
  areaCodeRegionNames,
} from "@/i18n/sections/areaCodes";

import { cityNpaMatches, normalizePlaceSearch } from "./city-npas";

/**
 * Area-code picker search (DESIGN.md G7 step 2): type a city, state/province,
 * or code → "(416) — Ontario"-style hints, powered by the shared NANP table
 * (code → { country, region, timezone }) plus a curated metro-name → NPA index
 * (./city-npas.ts). Region codes expand to full names; typing a major city
 * name (Houston, Calgary, Charlotte…) surfaces the NPAs that actually serve it
 * via the curated index, with the IANA timezone-city name as a last-resort
 * fallback for anything the curated list misses.
 *
 * #228: display names come from the locale catalogue, while search deliberately
 * matches BOTH catalogue spellings. A French reader sees "Québec" and can type
 * either "Québec" or "Quebec"; switching language changes the label without
 * throwing away the place name someone already knows.
 */

export function regionName(
  country: NanpCountry,
  region: string,
  locale: Locale,
): string {
  return areaCodeRegionName(country, region, locale);
}

/** All supported states, provinces, and territories, labelled for this reader. */
export function regionNames(
  country: NanpCountry,
  locale: Locale,
): Readonly<Record<string, string>> {
  return areaCodeRegionNames(country, locale);
}

export interface AreaCodeHint {
  code: string;
  country: NanpCountry;
  /** USPS state / Canada Post province code. */
  region: string;
  regionName: string;
  /** "(416) — Ontario" (G7 hint style). */
  label: string;
}

/** "America/New_York" → "new york" (search matching only, never displayed). */
function timezoneCity(timezone: string): string {
  const city = timezone.split("/").pop() ?? "";
  return normalizePlaceSearch(city.replace(/_/g, " "));
}

function toHint(
  code: string,
  entry: NanpGeographicEntry,
  locale: Locale,
): AreaCodeHint {
  const name = regionName(entry.country, entry.region, locale);
  return {
    code,
    country: entry.country,
    region: entry.region,
    regionName: name,
    label: `(${code}) · ${name}`,
  };
}

/** Geographic codes for one country, ascending — the pickable universe. */
export function areaCodesForCountry(
  country: NanpCountry,
  locale: Locale,
): AreaCodeHint[] {
  return Object.entries(NANP_AREA_CODES)
    .filter(
      (pair): pair is [string, NanpGeographicEntry] =>
        pair[1].geographic && pair[1].country === country,
    )
    .map(([code, entry]) => toHint(code, entry, locale))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Rank: exact/prefix code match → curated metro-name match → region-name
 * starts-with → either-language region-name / region-code match →
 * timezone-city match.
 * Empty/whitespace queries return [] (the picker shows its own prompt instead
 * of 300+ rows).
 */
export function searchAreaCodes(
  query: string,
  country: NanpCountry,
  locale: Locale,
  limit = 8,
): AreaCodeHint[] {
  const q = normalizePlaceSearch(query);
  if (q.length === 0) return [];

  const digits = /^\d{1,3}$/.test(q) ? q : null;
  // Curated metro-name → NPA hits, constrained to the chosen country.
  const cityCodes = digits ? new Set<string>() : new Set(cityNpaMatches(q));
  const ranked: { hint: AreaCodeHint; rank: number }[] = [];

  for (const [code, entry] of Object.entries(NANP_AREA_CODES)) {
    if (!entry.geographic || entry.country !== country) continue;
    const localizedName = normalizePlaceSearch(
      regionName(entry.country, entry.region, locale),
    );
    const aliases = areaCodeRegionAliases(entry.country, entry.region).map(
      normalizePlaceSearch,
    );

    let rank: number | null = null;
    if (digits) {
      if (code.startsWith(digits)) rank = code === digits ? 0 : 1;
    } else if (cityCodes.has(code)) {
      rank = 2;
    } else if (localizedName.startsWith(q)) {
      rank = 3;
    } else if (aliases.some((name) => name.startsWith(q))) {
      rank = 4;
    } else if (
      aliases.some((name) => name.includes(q)) ||
      entry.region.toLowerCase() === q
    ) {
      rank = 5;
    } else if (timezoneCity(entry.timezone).includes(q)) {
      rank = 6;
    }
    if (rank !== null) {
      ranked.push({ hint: toHint(code, entry, locale), rank });
    }
  }

  ranked.sort(
    (a, b) => a.rank - b.rank || a.hint.code.localeCompare(b.hint.code),
  );
  return ranked.slice(0, limit).map((r) => r.hint);
}

/** Lookup a picked code, constrained to the wizard's chosen country. */
export function areaCodeHint(
  code: string,
  country: NanpCountry,
  locale: Locale,
): AreaCodeHint | null {
  const entry = NANP_AREA_CODES[code];
  if (!entry || !entry.geographic || entry.country !== country) return null;
  return toHint(code, entry, locale);
}
