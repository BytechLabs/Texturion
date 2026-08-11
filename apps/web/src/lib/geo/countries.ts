import { DEFAULT_LOCALE, type Locale } from "@loonext/shared";

/**
 * #214 — country names for the task-address country field's typable autofill
 * dropdown (a native <datalist>). US + Canada lead (the product's primary
 * markets); the rest are alphabetical. Names are the stored value (the address
 * country column is freeform text, and the address is a reviewed suggestion),
 * so an off-list value (e.g. an enrichment's "CA") is still accepted as typed.
 *
 * ## #228: why these are NOT in the catalogue
 *
 * Two hundred country names hand-translated into `i18n/sections/` would be four
 * hundred lines of data in a file of copy, maintained by whoever notices a
 * country renamed itself. `Intl.DisplayNames` is the locale-aware formatter for
 * exactly this, it ships with the browser, and it is the same rule the
 * catalogue header already states for dates and money: a formatter that exists
 * beats a second numbering system invented here.
 *
 * So the module's own data is a list of ISO 3166-1 alpha-2 CODES — which are
 * identifiers, not copy — and the names are derived per locale.
 *
 * ## The label IS the value, which is why this had to be localised
 *
 * A `<datalist>` option's value is what the browser types into the field; the
 * label is a hint only two of the three engines render. So an English list
 * cannot be shown to a French reader with a French label — the choice is
 * between an English list and French VALUES. French values are right: the
 * column is a freeform address line, and a Quebec crew's address written in
 * French is a correct address, not a mistranslated one.
 *
 * ## Where we keep our own name for a place
 *
 * CLDR's English differs from this list in fourteen places. Ten are house
 * style — `&` for "and", `St.` for "Saint", a curly apostrophe — and those are
 * taken, because they match what the same reader's phone and operating system
 * call the same country. The four below are not style, they are the NAME, and
 * ours were chosen deliberately: a country that has asked to be called
 * something is called that here.
 */
const OVERRIDES: Record<string, Partial<Record<Locale, string>>> = {
  CV: { en: "Cabo Verde" },
  MM: { en: "Myanmar" },
  PS: { en: "Palestine", "fr-CA": "Palestine" },
  TR: { en: "Turkey" },
};

/** The two markets the product sells in, offered before the alphabet. */
const PRIMARY_MARKETS = ["US", "CA"] as const;

/**
 * Every country the dropdown offers, by ISO 3166-1 alpha-2 code.
 *
 * Sovereign states only, matching the list this replaced: a dependency or an
 * overseas territory is written into the address lines above this field, not
 * into the country one.
 */
const COUNTRY_CODES: readonly string[] = [
  ...PRIMARY_MARKETS,
  "AF", "AL", "DZ", "AD", "AO", "AG", "AR", "AM", "AU", "AT", "AZ", "BS", "BH",
  "BD", "BB", "BY", "BE", "BZ", "BJ", "BT", "BO", "BA", "BW", "BR", "BN", "BG",
  "BF", "BI", "CV", "KH", "CM", "CF", "TD", "CL", "CN", "CO", "KM", "CG", "CD",
  "CR", "CI", "HR", "CU", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC", "EG", "SV",
  "GQ", "ER", "EE", "SZ", "ET", "FJ", "FI", "FR", "GA", "GM", "GE", "DE", "GH",
  "GR", "GD", "GT", "GN", "GW", "GY", "HT", "HN", "HU", "IS", "IN", "ID", "IR",
  "IQ", "IE", "IL", "IT", "JM", "JP", "JO", "KZ", "KE", "KI", "XK", "KW", "KG",
  "LA", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MG", "MW", "MY", "MV",
  "ML", "MT", "MH", "MR", "MU", "MX", "FM", "MD", "MC", "MN", "ME", "MA", "MZ",
  "MM", "NA", "NR", "NP", "NL", "NZ", "NI", "NE", "NG", "KP", "MK", "NO", "OM",
  "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PL", "PT", "QA", "RO", "RU",
  "RW", "KN", "LC", "VC", "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG",
  "SK", "SI", "SB", "SO", "ZA", "KR", "SS", "ES", "LK", "SD", "SR", "SE", "CH",
  "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TO", "TT", "TN", "TR", "TM", "TV",
  "UG", "UA", "AE", "GB", "UY", "UZ", "VU", "VA", "VE", "VN", "YE", "ZM", "ZW",
];

/**
 * Built once per locale.
 *
 * Two hundred `Intl.DisplayNames` lookups and a collated sort on every render
 * of a field somebody opened to type one word would be a real cost on a phone,
 * and the answer never changes for a given language.
 */
const cache = new Map<string, readonly string[]>();

/**
 * The dropdown's options, in this reader's language.
 *
 * Sorted with the reader's own collation rather than by code point, because
 * `É` belongs with `E` in a French list and after `Z` in a naive one — an
 * alphabetical list that puts `États-Unis` at the bottom is not alphabetical to
 * the person reading it. The two primary markets stay pinned at the top in both
 * languages, which is the one place this list is not alphabetical on purpose.
 *
 * Returns an EMPTY list if the runtime has no `Intl.DisplayNames`. That is the
 * honest degradation for a suggestion list: the field is freeform and still
 * accepts anything typed into it, whereas a fallback list of `ZW` and `AE`
 * would be a dropdown of nonsense presented as the answer.
 */
export function countryNames(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  const cached = cache.get(locale);
  if (cached) return cached;

  let display: Intl.DisplayNames;
  try {
    display = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    return [];
  }

  const name = (code: string): string | null => {
    const ours = OVERRIDES[code]?.[locale];
    if (ours) return ours;
    let resolved: string | undefined;
    try {
      resolved = display.of(code);
    } catch {
      return null;
    }
    // `of` hands back the code itself for a region this runtime's data does not
    // carry. A two-letter code is not a country name, so the row is dropped
    // rather than shown — one missing suggestion, in a field that takes typing.
    return resolved && resolved !== code ? resolved : null;
  };

  const pinned = PRIMARY_MARKETS.map(name).filter(
    (value): value is string => value !== null,
  );
  const rest = COUNTRY_CODES.filter(
    (code) => !(PRIMARY_MARKETS as readonly string[]).includes(code),
  )
    .map(name)
    .filter((value): value is string => value !== null)
    .sort((a, b) => a.localeCompare(b, locale));

  const names = [...pinned, ...rest];
  cache.set(locale, names);
  return names;
}

/**
 * The same list in English, for a caller that has not been handed a locale yet.
 *
 * Read through {@link countryNames} rather than kept as a second array, so the
 * two can never disagree about which countries exist.
 */
export const COUNTRIES: readonly string[] = countryNames(DEFAULT_LOCALE);
