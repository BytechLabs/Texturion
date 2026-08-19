/**
 * D138 Rule 5 — the pages that exist in both languages, in one list.
 *
 * ## Why a registry rather than a field on each page
 *
 * `hreflang` is reciprocal or it is ignored: a French page pointing at its
 * English twin while the English one says nothing is the commonest way to get
 * this wrong, and search engines drop the pair rather than guess. A field on
 * each page makes that a thing two authors have to remember in two files. A
 * pair in one list makes it impossible — both sides are derived from the same
 * row, so a one-way link cannot be expressed.
 *
 * ## Adding a page
 *
 * Add the row when the French page SHIPS, not when it is started. D138 Rule 4
 * says a `/fr` URL with no translation returns 404 rather than English, and a
 * row here announces to Google that a translation exists. Announcing one that
 * 404s is worse than not announcing it.
 *
 * `marketing-translations.test.ts` holds the list to the filesystem in both
 * directions: a row whose French route file is missing fails, and a French
 * route file with no row fails. The second is the one that matters — it means
 * a page shipped without telling anybody it existed.
 */
export const TRANSLATED_PAGES: readonly { readonly en: string; readonly fr: string }[] = [
  { en: "/contact", fr: "/fr/contact" },
];

/** The `alternates.languages` pair for a path, in either language, or nothing. */
export function languagesFor(path: string): Record<string, string> | undefined {
  const row = TRANSLATED_PAGES.find((p) => p.en === path || p.fr === path);
  if (!row) return undefined;
  // Both entries on both pages. "x-default" names the version to serve a
  // reader whose language we have no page for, which is the English one.
  return {
    "en-CA": row.en,
    "fr-CA": row.fr,
    "x-default": row.en,
  };
}

/** Where the language switcher points from here, if anywhere. */
export function twinOf(path: string): { locale: "en" | "fr-CA"; path: string } | undefined {
  const row = TRANSLATED_PAGES.find((p) => p.en === path || p.fr === path);
  if (!row) return undefined;
  return path === row.en
    ? { locale: "fr-CA", path: row.fr }
    : { locale: "en", path: row.en };
}
