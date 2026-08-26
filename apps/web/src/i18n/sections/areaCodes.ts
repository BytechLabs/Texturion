import type { Locale, NanpCountry } from "@loonext/shared";

import type { Translated } from "../translated";

/**
 * Human place names used by the onboarding area-code picker.
 *
 * The shared NANP table remains the source of truth for which country, region,
 * timezone, and geographic status belong to a code. This catalogue owns the
 * localized region labels and established French city forms; `city-npas.ts`
 * keeps the verified base metro names beside their codes. Region keys are
 * deliberately derived from the stable country + postal abbreviation pair,
 * so adding a new NANP assignment cannot change or duplicate numbering data
 * here.
 *
 * City names are official proper names in both languages unless an established
 * French form exists. Only those forms need a separate catalogue entry; the
 * search index still creates an en/fr-CA alias pair for every city, including
 * the many pairs whose two spellings are identical.
 */
export const areaCodesEn = {
  regionUSAL: "Alabama",
  regionUSAK: "Alaska",
  regionUSAZ: "Arizona",
  regionUSAR: "Arkansas",
  regionUSCA: "California",
  regionUSCO: "Colorado",
  regionUSCT: "Connecticut",
  regionUSDE: "Delaware",
  regionUSDC: "Washington, DC",
  regionUSFL: "Florida",
  regionUSGA: "Georgia",
  regionUSHI: "Hawaii",
  regionUSID: "Idaho",
  regionUSIL: "Illinois",
  regionUSIN: "Indiana",
  regionUSIA: "Iowa",
  regionUSKS: "Kansas",
  regionUSKY: "Kentucky",
  regionUSLA: "Louisiana",
  regionUSME: "Maine",
  regionUSMD: "Maryland",
  regionUSMA: "Massachusetts",
  regionUSMI: "Michigan",
  regionUSMN: "Minnesota",
  regionUSMS: "Mississippi",
  regionUSMO: "Missouri",
  regionUSMT: "Montana",
  regionUSNE: "Nebraska",
  regionUSNV: "Nevada",
  regionUSNH: "New Hampshire",
  regionUSNJ: "New Jersey",
  regionUSNM: "New Mexico",
  regionUSNY: "New York",
  regionUSNC: "North Carolina",
  regionUSND: "North Dakota",
  regionUSOH: "Ohio",
  regionUSOK: "Oklahoma",
  regionUSOR: "Oregon",
  regionUSPA: "Pennsylvania",
  regionUSRI: "Rhode Island",
  regionUSSC: "South Carolina",
  regionUSSD: "South Dakota",
  regionUSTN: "Tennessee",
  regionUSTX: "Texas",
  regionUSUT: "Utah",
  regionUSVT: "Vermont",
  regionUSVA: "Virginia",
  regionUSWA: "Washington",
  regionUSWV: "West Virginia",
  regionUSWI: "Wisconsin",
  regionUSWY: "Wyoming",
  regionUSPR: "Puerto Rico",
  regionUSVI: "U.S. Virgin Islands",
  regionUSGU: "Guam",
  regionUSMP: "Northern Mariana Islands",
  regionUSAS: "American Samoa",

  regionCAAB: "Alberta",
  regionCABC: "British Columbia",
  regionCAMB: "Manitoba",
  regionCANB: "New Brunswick",
  regionCANL: "Newfoundland and Labrador",
  regionCANS: "Nova Scotia",
  regionCANT: "Northwest Territories",
  regionCANU: "Nunavut",
  regionCAON: "Ontario",
  regionCAPE: "Prince Edward Island",
  regionCAQC: "Quebec",
  regionCASK: "Saskatchewan",
  regionCAYT: "Yukon",

  cityPhiladelphia: "Philadelphia",
  cityNewOrleans: "New Orleans",
  cityStLouis: "St. Louis",
  citySaintLouis: "Saint Louis",
  citySaltLakeCity: "Salt Lake City",
  cityMontreal: "Montreal",
  cityQuebecCity: "Quebec City",
  cityQuebec: "Quebec",
} as const;

export const areaCodesFr: Translated<typeof areaCodesEn> = {
  regionUSAL: "Alabama",
  regionUSAK: "Alaska",
  regionUSAZ: "Arizona",
  regionUSAR: "Arkansas",
  regionUSCA: "Californie",
  regionUSCO: "Colorado",
  regionUSCT: "Connecticut",
  regionUSDE: "Delaware",
  regionUSDC: "District de Columbia",
  regionUSFL: "Floride",
  regionUSGA: "Géorgie",
  regionUSHI: "Hawaï",
  regionUSID: "Idaho",
  regionUSIL: "Illinois",
  regionUSIN: "Indiana",
  regionUSIA: "Iowa",
  regionUSKS: "Kansas",
  regionUSKY: "Kentucky",
  regionUSLA: "Louisiane",
  regionUSME: "Maine",
  regionUSMD: "Maryland",
  regionUSMA: "Massachusetts",
  regionUSMI: "Michigan",
  regionUSMN: "Minnesota",
  regionUSMS: "Mississippi",
  regionUSMO: "Missouri",
  regionUSMT: "Montana",
  regionUSNE: "Nebraska",
  regionUSNV: "Nevada",
  regionUSNH: "New Hampshire",
  regionUSNJ: "New Jersey",
  regionUSNM: "Nouveau-Mexique",
  regionUSNY: "New York",
  regionUSNC: "Caroline du Nord",
  regionUSND: "Dakota du Nord",
  regionUSOH: "Ohio",
  regionUSOK: "Oklahoma",
  regionUSOR: "Oregon",
  regionUSPA: "Pennsylvanie",
  regionUSRI: "Rhode Island",
  regionUSSC: "Caroline du Sud",
  regionUSSD: "Dakota du Sud",
  regionUSTN: "Tennessee",
  regionUSTX: "Texas",
  regionUSUT: "Utah",
  regionUSVT: "Vermont",
  regionUSVA: "Virginie",
  regionUSWA: "Washington",
  regionUSWV: "Virginie-Occidentale",
  regionUSWI: "Wisconsin",
  regionUSWY: "Wyoming",
  regionUSPR: "Porto Rico",
  regionUSVI: "Îles Vierges américaines",
  regionUSGU: "Guam",
  regionUSMP: "Îles Mariannes du Nord",
  regionUSAS: "Samoa américaines",

  regionCAAB: "Alberta",
  regionCABC: "Colombie-Britannique",
  regionCAMB: "Manitoba",
  regionCANB: "Nouveau-Brunswick",
  regionCANL: "Terre-Neuve-et-Labrador",
  regionCANS: "Nouvelle-Écosse",
  regionCANT: "Territoires du Nord-Ouest",
  regionCANU: "Nunavut",
  regionCAON: "Ontario",
  regionCAPE: "Île-du-Prince-Édouard",
  regionCAQC: "Québec",
  regionCASK: "Saskatchewan",
  regionCAYT: "Yukon",

  cityPhiladelphia: "Philadelphie",
  cityNewOrleans: "La Nouvelle-Orléans",
  cityStLouis: "Saint-Louis",
  citySaintLouis: "Saint-Louis",
  citySaltLakeCity: "Salt Lake City",
  cityMontreal: "Montréal",
  cityQuebecCity: "Québec",
  cityQuebec: "Québec",
};

type AreaCodeMessageKey = keyof typeof areaCodesEn;

const catalogs: Readonly<Record<Locale, Record<AreaCodeMessageKey, string>>> = {
  en: areaCodesEn,
  "fr-CA": areaCodesFr,
};

function regionKey(country: NanpCountry, region: string): AreaCodeMessageKey {
  return `region${country}${region}` as AreaCodeMessageKey;
}

/** Localized region label, preserving an unknown postal code as the fallback. */
export function areaCodeRegionName(
  country: NanpCountry,
  region: string,
  locale: Locale,
): string {
  return catalogs[locale][regionKey(country, region)] ?? region;
}

/** Both spellings stay searchable after a locale switch. */
export function areaCodeRegionAliases(
  country: NanpCountry,
  region: string,
): readonly string[] {
  const key = regionKey(country, region);
  const aliases = [catalogs.en[key], catalogs["fr-CA"][key]].filter(
    (value): value is string => typeof value === "string",
  );
  return [...new Set(aliases)];
}

/** All supported postal regions, including territories that share an NPA. */
export function areaCodeRegionNames(
  country: NanpCountry,
  locale: Locale,
): Readonly<Record<string, string>> {
  const prefix = `region${country}`;
  const entries = Object.keys(areaCodesEn)
    .filter((key) => key.startsWith(prefix))
    .map(
      (key) =>
        [
          key.slice(prefix.length),
          catalogs[locale][key as AreaCodeMessageKey],
        ] as const,
    )
    .sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

const cityKeys: Readonly<Record<string, AreaCodeMessageKey>> = {
  [areaCodesEn.cityPhiladelphia]: "cityPhiladelphia",
  [areaCodesEn.cityNewOrleans]: "cityNewOrleans",
  [areaCodesEn.cityStLouis]: "cityStLouis",
  [areaCodesEn.citySaintLouis]: "citySaintLouis",
  [areaCodesEn.citySaltLakeCity]: "citySaltLakeCity",
  [areaCodesEn.cityMontreal]: "cityMontreal",
  [areaCodesEn.cityQuebecCity]: "cityQuebecCity",
  [areaCodesEn.cityQuebec]: "cityQuebec",
};

/**
 * Localized city label. Most municipality names are proper names and therefore
 * identical in English and Canadian French; established French forms are
 * resolved through the catalogue above.
 */
export function areaCodeCityName(name: string, locale: Locale): string {
  const key = cityKeys[name];
  return key ? catalogs[locale][key] : name;
}

/** Every authored city gets an en/fr-CA search pair, even when both are equal. */
export function areaCodeCityAliases(name: string): readonly string[] {
  return [areaCodeCityName(name, "en"), areaCodeCityName(name, "fr-CA")];
}
