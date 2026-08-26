import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/** Shared chrome for every legal document, including the French `/fr` twins. */
export const legalPageEn = {
  home: "Home",
  lastUpdated: "Last updated",
  summaryLabel: "Plain English summary",
  contents: "Contents",
} as const;

export const legalPageFr: Translated<typeof legalPageEn> = {
  home: "Accueil",
  lastUpdated: "Dernière mise à jour",
  summaryLabel: "Résumé en langage clair",
  contents: "Table des matières",
};

const LEGAL_PAGE_COPY = {
  en: legalPageEn,
  "fr-CA": legalPageFr,
} as const;

export function legalPageCopy(locale: MarketingLocale = "en") {
  return LEGAL_PAGE_COPY[locale] ?? legalPageEn;
}
