import {
  NANP_AREA_CODES,
  type NanpCountry,
  type NanpGeographicEntry,
} from "@loonext/shared";

import { cityNpaMatches } from "./city-npas";

/**
 * Area-code picker search (DESIGN.md G7 step 2): type a city, state/province,
 * or code → "(416) — Ontario"-style hints, powered by the shared NANP table
 * (code → { country, region, timezone }) plus a curated metro-name → NPA index
 * (./city-npas.ts). Region codes expand to full names; typing a major city
 * name (Houston, Calgary, Charlotte…) surfaces the NPAs that actually serve it
 * via the curated index, with the IANA timezone-city name as a last-resort
 * fallback for anything the curated list misses.
 */

export const US_REGION_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "Washington, DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
  // NANP-served US territories.
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam",
  MP: "Northern Mariana Islands", AS: "American Samoa",
};

export const CA_REGION_NAMES: Readonly<Record<string, string>> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba",
  NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut",
  ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

export function regionName(country: NanpCountry, region: string): string {
  const table = country === "US" ? US_REGION_NAMES : CA_REGION_NAMES;
  return table[region] ?? region;
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
  return city.replace(/_/g, " ").toLowerCase();
}

function toHint(code: string, entry: NanpGeographicEntry): AreaCodeHint {
  const name = regionName(entry.country, entry.region);
  return {
    code,
    country: entry.country,
    region: entry.region,
    regionName: name,
    label: `(${code}) — ${name}`,
  };
}

/** Geographic codes for one country, ascending — the pickable universe. */
export function areaCodesForCountry(country: NanpCountry): AreaCodeHint[] {
  return Object.entries(NANP_AREA_CODES)
    .filter(
      (pair): pair is [string, NanpGeographicEntry] =>
        pair[1].geographic && pair[1].country === country,
    )
    .map(([code, entry]) => toHint(code, entry))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Rank: exact/prefix code match → curated metro-name match → region-name
 * starts-with → region-name / region-code match → timezone-city match.
 * Empty/whitespace queries return [] (the picker shows its own prompt instead
 * of 300+ rows).
 */
export function searchAreaCodes(
  query: string,
  country: NanpCountry,
  limit = 8,
): AreaCodeHint[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const digits = /^\d{1,3}$/.test(q) ? q : null;
  // Curated metro-name → NPA hits, constrained to the chosen country.
  const cityCodes = digits ? new Set<string>() : new Set(cityNpaMatches(q));
  const ranked: { hint: AreaCodeHint; rank: number }[] = [];

  for (const [code, entry] of Object.entries(NANP_AREA_CODES)) {
    if (!entry.geographic || entry.country !== country) continue;
    const name = regionName(entry.country, entry.region).toLowerCase();

    let rank: number | null = null;
    if (digits) {
      if (code.startsWith(digits)) rank = code === digits ? 0 : 1;
    } else if (cityCodes.has(code)) {
      rank = 2;
    } else if (name.startsWith(q)) {
      rank = 3;
    } else if (name.includes(q) || entry.region.toLowerCase() === q) {
      rank = 4;
    } else if (timezoneCity(entry.timezone).includes(q)) {
      rank = 5;
    }
    if (rank !== null) ranked.push({ hint: toHint(code, entry), rank });
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
): AreaCodeHint | null {
  const entry = NANP_AREA_CODES[code];
  if (!entry || !entry.geographic || entry.country !== country) return null;
  return toHint(code, entry);
}
