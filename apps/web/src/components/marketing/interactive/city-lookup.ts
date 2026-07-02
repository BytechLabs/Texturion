/**
 * City / area-code resolution for the §3.11 widget (Track B).
 *
 * Resolves a free-text query — a city name or a 3-digit area code — to a real
 * NANP result. It reuses the app's OWN verified data: the onboarding
 * `CITY_NPAS` index (city → NPAs, with a build-time invariant asserting every
 * code exists in the shared table) and the shared `NANP_AREA_CODES` table
 * (@jobtext/shared) for region/country. So the widget shows exactly what the
 * app's onboarding area-code picker would — one source of truth, nothing
 * invented (BLUEPRINT §3.10/§3.11: "reuses the NANP table island").
 */

import { NANP_AREA_CODES, type NanpEntry } from "@jobtext/shared";

import { CITY_NPA_INDEX } from "@/app/onboarding/city-npas";

/** USPS state / Canada Post province code → full display name. */
const REGION_NAMES: Record<string, string> = {
  // Canada
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
  // US
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands", GU: "Guam",
  MP: "Northern Mariana Islands", AS: "American Samoa",
};

export function regionName(code: string): string {
  return REGION_NAMES[code] ?? code;
}

export interface AreaCodeResult {
  /** City label, or "Area code NNN" for a direct code query. */
  city: string;
  areaCode: string;
  country: "US" | "CA";
  region: string | null;
  regionLabel: string | null;
}

function toResult(city: string, areaCode: string): AreaCodeResult | null {
  const entry: NanpEntry | undefined = NANP_AREA_CODES[areaCode];
  if (!entry) return null;
  return {
    city,
    areaCode,
    country: entry.country,
    region: entry.geographic ? entry.region : null,
    regionLabel: entry.geographic ? regionName(entry.region) : null,
  };
}

/**
 * Resolve a query to up to `limit` results.
 * - A 3-digit numeric query is treated as an area code (direct table lookup).
 * - Otherwise, a case-insensitive prefix-first match over the city index; the
 *   city's PRIMARY (first-listed) NPA is shown.
 */
export function resolveQuery(query: string, limit = 5): AreaCodeResult[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  // Direct area-code entry (3 digits).
  if (/^\d{3}$/.test(q)) {
    const r = toResult(`Area code ${q}`, q);
    return r ? [r] : [];
  }
  if (q.length < 2) return [];

  const prefix: AreaCodeResult[] = [];
  const contains: AreaCodeResult[] = [];
  const seenCities = new Set<string>();

  for (const entry of CITY_NPA_INDEX) {
    if (seenCities.has(entry.city)) continue;
    const primary = entry.codes[0];
    if (!primary) continue;

    if (entry.search.startsWith(q)) {
      const r = toResult(entry.city, primary);
      if (r) {
        prefix.push(r);
        seenCities.add(entry.city);
      }
    } else if (entry.search.includes(q)) {
      const r = toResult(entry.city, primary);
      if (r) {
        contains.push(r);
        seenCities.add(entry.city);
      }
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}
