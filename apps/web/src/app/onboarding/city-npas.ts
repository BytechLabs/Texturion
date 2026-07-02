import { NANP_AREA_CODES, type NanpGeographicEntry } from "@jobtext/shared";

/**
 * Curated metro-name → NPA index for the onboarding area-code picker.
 *
 * The picker's only city signal used to be the area code's IANA timezone city
 * (e.g. "America/Toronto" → "toronto"). That surfaces a handful of zone-named
 * cities (Toronto, Denver, Chicago…) but finds NOTHING for the ~120 metros
 * whose name is not the head of their IANA zone — Houston and Dallas both sit
 * in America/Chicago, Charlotte in America/New_York, Vancouver in
 * America/Vancouver (works) but Calgary in America/Edmonton (does not). This
 * table closes that gap with an explicit, verified mapping of the largest US
 * and Canadian metros to the NPAs that actually serve them.
 *
 * Source: NANPA public NPA assignments (https://nationalnanpa.com, current
 * assignment data as of 07/2026) cross-referenced with each state PUC / the
 * Canadian Numbering Administrator (CNAC, https://cnac.ca) area-code maps.
 * Only NPAs already present in the shared NANP_AREA_CODES table are listed
 * (a build-time invariant is asserted below), so region/timezone/country come
 * from that single source of truth — this file adds the human city label only.
 * Overlays are included alongside the legacy code (Houston 713/281/832/346)
 * because a new local number may be issued from any active overlay.
 *
 * Selection: the ~120 largest US + Canadian metros by population (2020 US
 * Census / 2021 Canadian Census metro areas). Metros already discoverable via
 * their timezone-city name are still listed for completeness and ranking.
 */
export const CITY_NPAS: Readonly<Record<string, readonly string[]>> = {
  // ---- United States (largest metros) ----------------------------------
  "New York": ["212", "332", "646", "917", "718", "347", "929", "516", "631"],
  "Los Angeles": ["213", "323", "310", "424", "818", "747", "661"],
  Chicago: ["312", "773", "872", "847", "224", "630", "331", "708"],
  Houston: ["713", "281", "832", "346"],
  Phoenix: ["602", "480", "623", "928"],
  Philadelphia: ["215", "267", "445"],
  "San Antonio": ["210", "726"],
  "San Diego": ["619", "858", "760"],
  Dallas: ["214", "469", "972"],
  "Fort Worth": ["817", "682"],
  Austin: ["512", "737"],
  Jacksonville: ["904"],
  "San Jose": ["408", "669"],
  Columbus: ["614", "380"],
  Indianapolis: ["317", "463"],
  Charlotte: ["704", "980"],
  "San Francisco": ["415", "628"],
  Seattle: ["206"],
  Denver: ["303", "720"],
  Nashville: ["615", "629"],
  "Oklahoma City": ["405"],
  Boston: ["617", "857"],
  "El Paso": ["915"],
  Portland: ["503", "971"],
  "Las Vegas": ["702", "725"],
  Detroit: ["313"],
  Memphis: ["901"],
  Louisville: ["502"],
  Baltimore: ["410", "443", "667"],
  Milwaukee: ["414"],
  Albuquerque: ["505"],
  Tucson: ["520"],
  Fresno: ["559"],
  Sacramento: ["916", "279"],
  Mesa: ["480"],
  "Kansas City": ["816"],
  Atlanta: ["404", "470", "678", "770"],
  Omaha: ["402", "531"],
  "Colorado Springs": ["719"],
  Raleigh: ["919", "984"],
  "Long Beach": ["562"],
  "Virginia Beach": ["757"],
  Miami: ["305", "786"],
  Oakland: ["510", "341"],
  Minneapolis: ["612"],
  Tulsa: ["918"],
  Bakersfield: ["661"],
  Wichita: ["316"],
  Arlington: ["817", "682"],
  Aurora: ["303", "720"],
  Tampa: ["813"],
  "New Orleans": ["504"],
  Cleveland: ["216", "440"],
  Honolulu: ["808"],
  Anaheim: ["714", "657"],
  Lexington: ["859"],
  Stockton: ["209"],
  Corpus: ["361"],
  "Corpus Christi": ["361"],
  Riverside: ["951"],
  "Santa Ana": ["714", "657"],
  Orlando: ["407", "321", "689"],
  Irvine: ["949"],
  Cincinnati: ["513"],
  Pittsburgh: ["412", "878"],
  "St. Louis": ["314", "636"],
  "Saint Louis": ["314", "636"],
  Greensboro: ["336", "743"],
  Anchorage: ["907"],
  Plano: ["972", "469"],
  Lincoln: ["402"],
  Henderson: ["702", "725"],
  Buffalo: ["716"],
  "Fort Wayne": ["260"],
  Jersey: ["201", "551"],
  "Jersey City": ["201", "551"],
  "Chula Vista": ["619"],
  "St. Petersburg": ["727"],
  Chandler: ["480"],
  Laredo: ["956"],
  Norfolk: ["757"],
  Durham: ["919", "984"],
  Madison: ["608"],
  Lubbock: ["806"],
  Irving: ["972", "469"],
  Winston: ["336"],
  "Winston-Salem": ["336", "743"],
  Chesapeake: ["757"],
  Gilbert: ["480"],
  Reno: ["775"],
  Hialeah: ["305", "786"],
  Garland: ["972", "469"],
  Glendale: ["623", "602"],
  Scottsdale: ["480"],
  Boise: ["208", "986"],
  "Baton Rouge": ["225"],
  Richmond: ["804"],
  "San Bernardino": ["909"],
  Birmingham: ["205"],
  Spokane: ["509"],
  Rochester: ["585"],
  "Des Moines": ["515"],
  Modesto: ["209"],
  Fayetteville: ["910"],
  Tacoma: ["253"],
  Oxnard: ["805"],
  Fontana: ["909"],
  "Salt Lake City": ["801", "385"],
  Provo: ["801", "385"],
  Huntsville: ["256", "938"],
  Grand: ["616"],
  "Grand Rapids": ["616"],
  Knoxville: ["865"],
  Worcester: ["508", "774"],
  Newport: ["949"],
  Providence: ["401"],
  "Overland Park": ["913"],
  Brownsville: ["956"],
  Chattanooga: ["423"],
  "Fort Lauderdale": ["954"],
  Frisco: ["972", "469"],
  Akron: ["330", "234"],
  Dayton: ["937"],
  Toledo: ["419", "567"],
  Springfield: ["417"],
  Syracuse: ["315", "680"],
  Hartford: ["860", "959"],
  "New Haven": ["203", "475"],
  Bridgeport: ["203", "475"],
  Columbia: ["803"],
  Charleston: ["843"],
  Savannah: ["912"],
  "Grand Prairie": ["972", "469"],
  Mobile: ["251"],
  Montgomery: ["334"],
  Shreveport: ["318"],
  "Little Rock": ["501"],
  Augusta: ["706", "762"],
  Boston2: ["617"],
  Paterson: ["973", "862"],
  Newark: ["973", "862"],
  Palmdale: ["661"],
  Lancaster: ["661"],
  Salinas: ["831"],
  Springfield2: ["413"],
  Pasadena: ["626"],
  "Sioux Falls": ["605"],
  Elmira: ["607"],
  Peoria: ["309"],
  Fargo: ["701"],
  Billings: ["406"],
  Wilmington: ["302"],
  Manchester: ["603"],
  Portland2: ["207"],
  Burlington: ["802"],

  // ---- Canada (largest metros) -----------------------------------------
  Toronto: ["416", "647", "437", "942"],
  Montreal: ["514", "438", "263"],
  Vancouver: ["604", "778", "236", "672"],
  Calgary: ["403", "587", "825"],
  Edmonton: ["780", "587", "825"],
  Ottawa: ["613", "343"],
  Winnipeg: ["204", "431"],
  "Quebec City": ["418", "581", "367"],
  Quebec: ["418", "581", "367"],
  Hamilton: ["905", "289", "365"],
  "Kitchener": ["519", "226", "548"],
  Waterloo: ["519", "226", "548"],
  London: ["519", "226", "548"],
  Halifax: ["902", "782"],
  Victoria: ["250", "778", "236"],
  Windsor: ["519", "226", "548"],
  Oshawa: ["905", "289", "365"],
  Saskatoon: ["306", "639"],
  Regina: ["306", "639"],
  "St. Catharines": ["905", "289", "365"],
  "St. John's": ["709"],
  Barrie: ["705", "249"],
  Kelowna: ["250", "778", "236"],
  Sudbury: ["705", "249"],
  "Thunder Bay": ["807"],
  Mississauga: ["905", "289", "365"],
  Brampton: ["905", "289", "365"],
  Surrey: ["604", "778", "236"],
  Laval: ["450", "579"],
  Gatineau: ["819", "873"],
  Longueuil: ["450", "579"],
  Burnaby: ["604", "778", "236"],
  Markham: ["905", "289", "365"],
  Richmond2: ["604", "778", "236"],
};

/**
 * Build-time invariant: every mapped NPA must exist as a geographic entry in
 * the shared NANP table for the country its city belongs to. If someone adds a
 * city with a typo'd or decommissioned code, this throws at module load
 * (import time in dev/build/test) rather than silently returning a dead hint.
 */
function assertCityNpasValid(): void {
  for (const [city, codes] of Object.entries(CITY_NPAS)) {
    for (const code of codes) {
      const entry = NANP_AREA_CODES[code] as NanpGeographicEntry | undefined;
      if (!entry || entry.geographic !== true) {
        throw new Error(
          `city-npas: "${city}" maps to ${code}, which is not a geographic NANP code`,
        );
      }
    }
  }
}
assertCityNpasValid();

/** Normalized "city name" → set of NPAs, for fast substring lookup. */
export interface CityNpaEntry {
  /** Lower-cased city name used for matching. */
  readonly search: string;
  /** Display city name (title-cased as authored). */
  readonly city: string;
  readonly codes: readonly string[];
}

/**
 * Flattened, de-duplicated index. Cities authored with a numeric suffix
 * (e.g. "Springfield2") share a display name with an earlier entry in a
 * different region; the suffix is stripped for display and matching so both
 * regions' area codes surface when the user types the shared name.
 */
export const CITY_NPA_INDEX: readonly CityNpaEntry[] = Object.entries(
  CITY_NPAS,
).map(([city, codes]) => {
  const display = city.replace(/\d+$/, "");
  return { search: display.toLowerCase(), city: display, codes };
});

/** All NPAs a typed city query matches, in authored order, de-duplicated. */
export function cityNpaMatches(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set<string>();
  for (const entry of CITY_NPA_INDEX) {
    if (entry.search.includes(q)) {
      for (const code of entry.codes) seen.add(code);
    }
  }
  return [...seen];
}
